// node:sqlite のエラーの errcode は拡張結果コード（test/db.test.js で確認している）
const SQLITE_CONSTRAINT_UNIQUE = 2067;

// API で返す状態（実効の状態）。取り下げた申請は DB の status が pending のまま
// withdrawn_at だけが入るため、status を条件にする SQL はこの式を使う（ADR-0008）。
// toClaim の effectiveStatus と同じ規則
const EFFECTIVE_STATUS_SQL = `CASE WHEN withdrawn_at IS NOT NULL THEN 'withdrawn' ELSE status END`;

function effectiveStatus(row) {
  return row.withdrawn_at != null ? 'withdrawn' : row.status;
}

function toClaim(row) {
  if (!row) return null;
  return {
    id: row.id,
    applicantId: row.applicant_id,
    date: row.date,
    amount: row.amount,
    description: row.description,
    status: effectiveStatus(row),
    createdAt: row.created_at,
    decidedBy: row.decided_by ?? null,
    decidedAt: row.decided_at ?? null,
    rejectReason: row.reject_reason ?? null,
    resubmittedFrom: row.resubmitted_from ?? null,
    resubmitNote: row.resubmit_note ?? null,
    withdrawnAt: row.withdrawn_at ?? null,
  };
}

export function createRepository(db) {
  const insertStmt = db.prepare(
    `INSERT INTO expense_claims
       (applicant_id, date, amount, description, status, created_at,
        resubmitted_from, resubmit_note)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
  );
  const findByIdStmt = db.prepare('SELECT * FROM expense_claims WHERE id = ?');
  // 条件は null なら「指定なし」として扱う（申請者・状態の組み合わせを 1 つの文で扱う）
  const listStmt = db.prepare(
    `SELECT * FROM expense_claims
     WHERE (:applicantId IS NULL OR applicant_id = :applicantId)
       AND (:status IS NULL OR ${EFFECTIVE_STATUS_SQL} = :status)
     ORDER BY created_at DESC, id DESC`,
  );
  const decideStmt = db.prepare(
    `UPDATE expense_claims SET status = ?, decided_by = ?, decided_at = ?, reject_reason = ?
     WHERE id = ? AND status = 'pending' AND withdrawn_at IS NULL`,
  );
  // 申請者の確認も条件に含め、判定と更新を 1 文で行う（ADR-0005）
  const withdrawStmt = db.prepare(
    `UPDATE expense_claims SET withdrawn_at = ?
     WHERE id = ? AND applicant_id = ? AND status = 'pending' AND withdrawn_at IS NULL`,
  );
  const findResubmissionStmt = db.prepare(
    'SELECT id FROM expense_claims WHERE resubmitted_from = ?',
  );
  const summarizeByMonthStmt = db.prepare(
    `SELECT ${EFFECTIVE_STATUS_SQL} AS status,
            COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total_amount
     FROM expense_claims
     WHERE substr(date, 1, 7) = ?
     GROUP BY ${EFFECTIVE_STATUS_SQL}`,
  );

  function findById(id) {
    return toClaim(findByIdStmt.get(id));
  }

  // 通常の作成と出し直しで同じ挿入文を使う（出し直しでない申請は resubmittedFrom・resubmitNote が null）
  function insert(
    { applicantId, date, amount, description },
    { resubmittedFrom = null, resubmitNote = null } = {},
  ) {
    const { lastInsertRowid } = insertStmt.run(
      applicantId,
      date,
      amount,
      description,
      new Date().toISOString(),
      resubmittedFrom,
      resubmitNote,
    );
    return findById(lastInsertRowid);
  }

  // 他人の申請の存在を明かさないため、申請者の確認を状態の確認より先に行う
  function checkAndResubmit(sourceId, applicantId, { date, amount, description, resubmitNote }) {
    const source = findByIdStmt.get(sourceId);
    if (!source || source.applicant_id !== applicantId) {
      return { result: 'not_found' };
    }
    if (source.status !== 'rejected') {
      return { result: 'conflict', reason: 'status', claim: toClaim(source) };
    }
    if (findResubmissionStmt.get(sourceId)) {
      return { result: 'conflict', reason: 'already_resubmitted' };
    }
    const claim = insert(
      { applicantId, date, amount, description },
      { resubmittedFrom: sourceId, resubmitNote },
    );
    return { result: 'created', claim };
  }

  return {
    create(input) {
      return insert(input);
    },

    list({ applicantId, status } = {}) {
      const rows = listStmt.all({
        applicantId: applicantId ?? null,
        status: status ?? null,
      });
      return rows.map(toClaim);
    },

    findById,

    decide(id, status, approverId, rejectReason = null) {
      const { changes } = decideStmt.run(
        status,
        approverId,
        new Date().toISOString(),
        rejectReason,
        id,
      );
      if (changes > 0) {
        return { result: 'updated', claim: findById(id) };
      }
      const existing = findById(id);
      if (!existing) return { result: 'not_found' };
      return { result: 'conflict', claim: existing };
    },

    // 他人の申請は状態に関わらず not_found にする（存在を明かさないため、ADR-0003）
    withdraw(id, applicantId) {
      const { changes } = withdrawStmt.run(new Date().toISOString(), id, applicantId);
      if (changes > 0) {
        return { result: 'updated', claim: findById(id) };
      }
      const existing = findById(id);
      if (!existing || existing.applicantId !== applicantId) return { result: 'not_found' };
      return { result: 'conflict', claim: existing };
    },

    // 判定と挿入を 1 つのトランザクションで行う。一意インデックスは事前の確認をすり抜けた場合の最後の防御
    resubmit(sourceId, applicantId, input) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const outcome = checkAndResubmit(sourceId, applicantId, input);
        db.exec('COMMIT');
        return outcome;
      } catch (err) {
        db.exec('ROLLBACK');
        if (err.errcode === SQLITE_CONSTRAINT_UNIQUE) {
          return { result: 'conflict', reason: 'already_resubmitted' };
        }
        throw err;
      }
    },

    // 該当行のない状態も 0 で返すため、4 状態を初期化してから結果を当てはめる
    summarizeByMonth(month) {
      const byStatus = {
        pending: { count: 0, totalAmount: 0 },
        approved: { count: 0, totalAmount: 0 },
        rejected: { count: 0, totalAmount: 0 },
        withdrawn: { count: 0, totalAmount: 0 },
      };
      for (const row of summarizeByMonthStmt.all(month)) {
        byStatus[row.status] = { count: row.count, totalAmount: row.total_amount };
      }
      return { month, byStatus };
    },
  };
}

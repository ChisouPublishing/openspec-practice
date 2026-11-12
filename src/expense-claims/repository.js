function toClaim(row) {
  if (!row) return null;
  return {
    id: row.id,
    applicantId: row.applicant_id,
    date: row.date,
    amount: row.amount,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    decidedBy: row.decided_by ?? null,
    decidedAt: row.decided_at ?? null,
  };
}

export function createRepository(db) {
  const insertStmt = db.prepare(
    `INSERT INTO expense_claims (applicant_id, date, amount, description, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  );
  const findByIdStmt = db.prepare('SELECT * FROM expense_claims WHERE id = ?');
  const listAllStmt = db.prepare(
    'SELECT * FROM expense_claims ORDER BY created_at DESC, id DESC',
  );
  const listByApplicantStmt = db.prepare(
    'SELECT * FROM expense_claims WHERE applicant_id = ? ORDER BY created_at DESC, id DESC',
  );
  const decideStmt = db.prepare(
    `UPDATE expense_claims SET status = ?, decided_by = ?, decided_at = ?
     WHERE id = ? AND status = 'pending'`,
  );

  function findById(id) {
    return toClaim(findByIdStmt.get(id));
  }

  return {
    create({ applicantId, date, amount, description }) {
      const { lastInsertRowid } = insertStmt.run(
        applicantId,
        date,
        amount,
        description,
        new Date().toISOString(),
      );
      return findById(lastInsertRowid);
    },

    list({ applicantId } = {}) {
      const rows =
        applicantId === undefined ? listAllStmt.all() : listByApplicantStmt.all(applicantId);
      return rows.map(toClaim);
    },

    findById,

    decide(id, status, approverId) {
      const { changes } = decideStmt.run(status, approverId, new Date().toISOString(), id);
      if (changes > 0) {
        return { result: 'updated', claim: findById(id) };
      }
      const existing = findById(id);
      if (!existing) return { result: 'not_found' };
      return { result: 'conflict', claim: existing };
    },
  };
}

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createRepository } from '../src/expense-claims/repository.js';

let db;
let repo;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = createRepository(db);
});

afterEach(() => {
  db.close();
});

const input = (applicantId, description = 'タクシー代') => ({
  applicantId,
  date: '2026-11-01',
  amount: 1200,
  description,
});

test('create は pending の申請を作成しキャメルケースで返す', () => {
  const claim = repo.create(input('u1'));
  assert.equal(typeof claim.id, 'number');
  assert.equal(claim.applicantId, 'u1');
  assert.equal(claim.date, '2026-11-01');
  assert.equal(claim.amount, 1200);
  assert.equal(claim.description, 'タクシー代');
  assert.equal(claim.status, 'pending');
  assert.match(claim.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(claim.decidedBy, null);
  assert.equal(claim.decidedAt, null);
  assert.deepEqual(repo.findById(claim.id), claim);
});

test('create 直後の rejectReason は null', () => {
  const claim = repo.create(input('u1'));
  assert.equal(claim.rejectReason, null);
});

test('create 直後の resubmittedFrom は null', () => {
  const claim = repo.create(input('u1'));
  assert.equal(claim.resubmittedFrom, null);
});

test('create 直後の resubmitNote は null', () => {
  const claim = repo.create(input('u1'));
  assert.equal(claim.resubmitNote, null);
});

test('decide で差戻すと rejectReason が記録される', () => {
  const claim = repo.create(input('u1'));
  const { result, claim: updated } = repo.decide(claim.id, 'rejected', 'a1', '理由');
  assert.equal(result, 'updated');
  assert.equal(updated.status, 'rejected');
  assert.equal(updated.rejectReason, '理由');
  assert.equal(repo.findById(claim.id).rejectReason, '理由');
});

test('終端状態への decide は conflict を返し、既存の rejectReason を上書きしない', () => {
  const claim = repo.create(input('u1'));
  repo.decide(claim.id, 'rejected', 'a1', '最初の理由');
  const { result } = repo.decide(claim.id, 'rejected', 'a2', '別の理由');
  assert.equal(result, 'conflict');
  const after = repo.findById(claim.id);
  assert.equal(after.rejectReason, '最初の理由');
  assert.equal(after.decidedBy, 'a1');
});

test('findById は存在しない ID に null を返す', () => {
  assert.equal(repo.findById(999), null);
});

test('list は applicantId で絞り込める', () => {
  repo.create(input('u1'));
  repo.create(input('u2'));
  repo.create(input('u1'));
  const mine = repo.list({ applicantId: 'u1' });
  assert.equal(mine.length, 2);
  assert.ok(mine.every((c) => c.applicantId === 'u1'));
  assert.equal(repo.list().length, 3);
});

test('list は created_at DESC, id DESC の順で返す', () => {
  // 同時刻でも id の降順で安定する
  const a = repo.create(input('u1', 'A'));
  const b = repo.create(input('u1', 'B'));
  const c = repo.create(input('u1', 'C'));
  db.prepare('UPDATE expense_claims SET created_at = ?').run('2026-11-01T00:00:00.000Z');
  db.prepare('UPDATE expense_claims SET created_at = ? WHERE id = ?').run(
    '2026-11-02T00:00:00.000Z',
    a.id,
  );
  assert.deepEqual(
    repo.list().map((x) => x.id),
    [a.id, c.id, b.id],
  );
});

// u1・u2 それぞれに未判断・承認済み・差戻しの申請を 1 件ずつ作る（作成順に返す）
function claimsInEachStatus() {
  const created = [];
  for (const applicantId of ['u1', 'u2']) {
    const pending = repo.create(input(applicantId));
    const approved = repo.create(input(applicantId));
    const rejected = repo.create(input(applicantId));
    repo.decide(approved.id, 'approved', 'a1');
    repo.decide(rejected.id, 'rejected', 'a1', '理由');
    created.push({ applicantId, pending, approved, rejected });
  }
  return created;
}

test('list は status だけを指定すると全申請者のその状態の申請を新しい順で返す', () => {
  const [u1, u2] = claimsInEachStatus();
  assert.deepEqual(
    repo.list({ status: 'pending' }).map((c) => c.id),
    [u2.pending.id, u1.pending.id],
  );
  assert.ok(repo.list({ status: 'approved' }).every((c) => c.status === 'approved'));
  assert.equal(repo.list({ status: 'approved' }).length, 2);
});

test('list は applicantId と status の両方で絞り込める', () => {
  const [u1] = claimsInEachStatus();
  assert.deepEqual(
    repo.list({ applicantId: 'u1', status: 'rejected' }).map((c) => c.id),
    [u1.rejected.id],
  );
});

test('list は条件を指定しないと全件を返す', () => {
  claimsInEachStatus();
  assert.equal(repo.list().length, 6);
  assert.equal(repo.list({}).length, 6);
});

test('decide は pending の申請を更新し updated を返す', () => {
  const claim = repo.create(input('u1'));
  const { result, claim: updated } = repo.decide(claim.id, 'approved', 'a1');
  assert.equal(result, 'updated');
  assert.equal(updated.status, 'approved');
  assert.equal(updated.decidedBy, 'a1');
  assert.match(updated.decidedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('decide は存在しない ID に not_found を返す', () => {
  assert.deepEqual(repo.decide(999, 'approved', 'a1'), { result: 'not_found' });
});

test('decide は終端状態の申請に conflict を返し状態を変えない', () => {
  const claim = repo.create(input('u1'));
  repo.decide(claim.id, 'rejected', 'a1');
  const { result } = repo.decide(claim.id, 'approved', 'a2');
  assert.equal(result, 'conflict');
  const after = repo.findById(claim.id);
  assert.equal(after.status, 'rejected');
  assert.equal(after.decidedBy, 'a1');
});

const resubmitInput = {
  date: '2026-11-02',
  amount: 1500,
  description: 'タクシー代（領収書添付）',
  resubmitNote: '領収書を添付しました',
};

function rejectedClaim(applicantId = 'u1') {
  const claim = repo.create(input(applicantId));
  repo.decide(claim.id, 'rejected', 'a1', '領収書がありません');
  return repo.findById(claim.id);
}

const countRows = () => db.prepare('SELECT COUNT(*) AS n FROM expense_claims').get().n;

test('resubmit は差戻した申請から出し直した申請を作成し、元の申請は変えない', () => {
  const source = rejectedClaim('u1');
  const outcome = repo.resubmit(source.id, 'u1', resubmitInput);
  assert.equal(outcome.result, 'created');
  const { claim } = outcome;
  assert.notEqual(claim.id, source.id);
  assert.equal(claim.applicantId, 'u1');
  assert.equal(claim.status, 'pending');
  assert.equal(claim.date, '2026-11-02');
  assert.equal(claim.amount, 1500);
  assert.equal(claim.description, 'タクシー代（領収書添付）');
  assert.equal(claim.resubmittedFrom, source.id);
  assert.equal(claim.resubmitNote, '領収書を添付しました');
  assert.equal(claim.decidedBy, null);
  assert.equal(claim.decidedAt, null);
  assert.equal(claim.rejectReason, null);
  assert.deepEqual(repo.findById(source.id), source);
  assert.equal(source.resubmitNote, null);
});

test('resubmit は存在しない ID と他人の申請に not_found を返す', () => {
  assert.deepEqual(repo.resubmit(999, 'u1', resubmitInput), { result: 'not_found' });
  const othersRejected = rejectedClaim('u1');
  assert.deepEqual(repo.resubmit(othersRejected.id, 'u2', resubmitInput), {
    result: 'not_found',
  });
  const othersPending = repo.create(input('u1'));
  assert.deepEqual(repo.resubmit(othersPending.id, 'u2', resubmitInput), {
    result: 'not_found',
  });
  assert.equal(countRows(), 2);
});

test('resubmit は pending・approved の申請に conflict（status）を返す', () => {
  const pending = repo.create(input('u1'));
  const approved = repo.create(input('u1'));
  repo.decide(approved.id, 'approved', 'a1');
  for (const claim of [pending, approved]) {
    const outcome = repo.resubmit(claim.id, 'u1', resubmitInput);
    assert.equal(outcome.result, 'conflict');
    assert.equal(outcome.reason, 'status');
  }
  assert.equal(countRows(), 2);
});

test('resubmit は 2 回目に conflict（already_resubmitted）を返し、行を増やさない', () => {
  const source = rejectedClaim('u1');
  assert.equal(repo.resubmit(source.id, 'u1', resubmitInput).result, 'created');
  const second = repo.resubmit(source.id, 'u1', resubmitInput);
  assert.deepEqual(second, { result: 'conflict', reason: 'already_resubmitted' });
  assert.equal(countRows(), 2);
});

test('出し直した申請を差戻すと、その申請から出し直せる', () => {
  const source = rejectedClaim('u1');
  const { claim: first } = repo.resubmit(source.id, 'u1', resubmitInput);
  repo.decide(first.id, 'rejected', 'a1', '金額が誤っています');
  const outcome = repo.resubmit(first.id, 'u1', { ...resubmitInput, resubmitNote: '金額を直しました' });
  assert.equal(outcome.result, 'created');
  assert.equal(outcome.claim.resubmittedFrom, first.id);
  assert.equal(outcome.claim.resubmitNote, '金額を直しました');
});

test('withdraw は pending の申請を withdrawn にし withdrawnAt を記録する', () => {
  const claim = repo.create(input('u1'));
  assert.equal(claim.withdrawnAt, null);
  const { result, claim: updated } = repo.withdraw(claim.id, 'u1');
  assert.equal(result, 'updated');
  assert.equal(updated.status, 'withdrawn');
  assert.match(updated.withdrawnAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(updated.decidedBy, null);
  assert.equal(updated.decidedAt, null);
  assert.equal(updated.rejectReason, null);
  assert.deepEqual(repo.findById(claim.id), updated);
  // DB の status は pending のまま（ADR-0008）
  assert.equal(
    db.prepare('SELECT status FROM expense_claims WHERE id = ?').get(claim.id).status,
    'pending',
  );
});

test('withdraw は存在しない ID と他人の申請に not_found を返し、行を変えない', () => {
  assert.deepEqual(repo.withdraw(999, 'u1'), { result: 'not_found' });
  const othersPending = repo.create(input('u1'));
  const othersApproved = repo.create(input('u1'));
  repo.decide(othersApproved.id, 'approved', 'a1');
  for (const claim of [othersPending, othersApproved]) {
    const before = repo.findById(claim.id);
    assert.deepEqual(repo.withdraw(claim.id, 'u2'), { result: 'not_found' });
    assert.deepEqual(repo.findById(claim.id), before);
  }
});

test('withdraw は approved・rejected・取り下げ済みの申請に conflict を返し、行を変えない', () => {
  const approved = repo.create(input('u1'));
  repo.decide(approved.id, 'approved', 'a1');
  const rejected = rejectedClaim('u1');
  const withdrawn = repo.create(input('u1'));
  repo.withdraw(withdrawn.id, 'u1');
  for (const { id } of [approved, rejected, withdrawn]) {
    const before = repo.findById(id);
    const outcome = repo.withdraw(id, 'u1');
    assert.equal(outcome.result, 'conflict');
    assert.deepEqual(outcome.claim, before);
    assert.deepEqual(repo.findById(id), before);
  }
});

test('取り下げた申請への decide は conflict を返し、状態を変えない', () => {
  const claim = repo.create(input('u1'));
  const { claim: withdrawn } = repo.withdraw(claim.id, 'u1');
  for (const [status, reason] of [['approved', null], ['rejected', '理由']]) {
    const outcome = repo.decide(claim.id, status, 'a1', reason);
    assert.equal(outcome.result, 'conflict');
    assert.equal(outcome.claim.status, 'withdrawn');
  }
  assert.deepEqual(repo.findById(claim.id), withdrawn);
});

test('取り下げた申請は findById・list・summarizeByMonth のすべてで withdrawn として扱われる', () => {
  const pending = repo.create(input('u1'));
  const withdrawn = repo.create(input('u1'));
  repo.withdraw(withdrawn.id, 'u1');
  assert.equal(repo.findById(withdrawn.id).status, 'withdrawn');
  assert.equal(repo.list().find((c) => c.id === withdrawn.id).status, 'withdrawn');
  assert.deepEqual(
    repo.list({ status: 'withdrawn' }).map((c) => c.id),
    [withdrawn.id],
  );
  assert.deepEqual(
    repo.list({ status: 'pending' }).map((c) => c.id),
    [pending.id],
  );
  assert.deepEqual(repo.summarizeByMonth('2026-11').byStatus, {
    pending: { count: 1, totalAmount: 1200 },
    approved: zero,
    rejected: zero,
    withdrawn: { count: 1, totalAmount: 1200 },
  });
});

const claimOn = (applicantId, date, amount) => ({
  applicantId,
  date,
  amount,
  description: '経費',
});

const zero = { count: 0, totalAmount: 0 };

test('summarizeByMonth は状態ごとの件数と合計を返す', () => {
  const approved = repo.create(claimOn('u1', '2026-11-01', 1000));
  const rejected = repo.create(claimOn('u1', '2026-11-15', 2000));
  repo.create(claimOn('u1', '2026-11-30', 3000));
  repo.create(claimOn('u1', '2026-11-20', 500));
  repo.decide(approved.id, 'approved', 'a1');
  repo.decide(rejected.id, 'rejected', 'a1', '理由');
  assert.deepEqual(repo.summarizeByMonth('2026-11'), {
    month: '2026-11',
    byStatus: {
      pending: { count: 2, totalAmount: 3500 },
      approved: { count: 1, totalAmount: 1000 },
      rejected: { count: 1, totalAmount: 2000 },
      withdrawn: zero,
    },
  });
});

test('summarizeByMonth は前月末と翌月初の申請を含めない', () => {
  repo.create(claimOn('u1', '2026-10-31', 100));
  repo.create(claimOn('u1', '2026-12-01', 200));
  repo.create(claimOn('u1', '2026-11-10', 300));
  assert.deepEqual(repo.summarizeByMonth('2026-11').byStatus, {
    pending: { count: 1, totalAmount: 300 },
    approved: zero,
    rejected: zero,
    withdrawn: zero,
  });
});

test('summarizeByMonth は複数の申請者の申請を合算する', () => {
  repo.create(claimOn('u1', '2026-11-05', 1000));
  repo.create(claimOn('u2', '2026-11-06', 2500));
  assert.deepEqual(repo.summarizeByMonth('2026-11').byStatus.pending, {
    count: 2,
    totalAmount: 3500,
  });
});

test('summarizeByMonth は該当なしの月で 4 状態すべてが 0', () => {
  repo.create(claimOn('u1', '2026-11-05', 1000));
  assert.deepEqual(repo.summarizeByMonth('2027-01'), {
    month: '2027-01',
    byStatus: { pending: zero, approved: zero, rejected: zero, withdrawn: zero },
  });
});

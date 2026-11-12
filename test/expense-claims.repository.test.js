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

test('summarizeByMonth は該当なしの月で 3 状態すべてが 0', () => {
  repo.create(claimOn('u1', '2026-11-05', 1000));
  assert.deepEqual(repo.summarizeByMonth('2027-01'), {
    month: '2027-01',
    byStatus: { pending: zero, approved: zero, rejected: zero },
  });
});

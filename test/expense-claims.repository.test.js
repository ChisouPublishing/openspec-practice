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

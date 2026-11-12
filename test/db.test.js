import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db.js';

const columnNames = (db) =>
  db.prepare('PRAGMA table_info(expense_claims)').all().map((c) => c.name);

test('openDatabase はインメモリ DB に expense_claims テーブルを作成する', () => {
  const db = openDatabase(':memory:');
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'expense_claims'")
    .get();
  assert.equal(row?.name, 'expense_claims');
  db.close();
});

test('同じ DB に対して 2 回呼んでもエラーにならない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expense-db-'));
  try {
    const path = join(dir, 'test.db');
    openDatabase(path).close();
    assert.doesNotThrow(() => openDatabase(path).close());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('新規 DB に reject_reason 列がある', () => {
  const db = openDatabase(':memory:');
  assert.ok(columnNames(db).includes('reject_reason'));
  db.close();
});

test('reject_reason のない旧スキーマの DB を開くと列が追加され、既存行は NULL になる', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expense-db-'));
  try {
    const path = join(dir, 'old.db');
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE expense_claims (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        applicant_id TEXT    NOT NULL,
        date         TEXT    NOT NULL,
        amount       INTEGER NOT NULL CHECK (amount > 0),
        description  TEXT    NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
        created_at   TEXT    NOT NULL,
        decided_by   TEXT,
        decided_at   TEXT
      );
      INSERT INTO expense_claims
        (applicant_id, date, amount, description, status, created_at, decided_by, decided_at)
      VALUES
        ('u1', '2026-11-01', 1200, 'タクシー代', 'rejected',
         '2026-11-01T00:00:00.000Z', 'a1', '2026-11-02T00:00:00.000Z');
    `);
    assert.ok(!columnNames(old).includes('reject_reason'));
    old.close();

    const db = openDatabase(path);
    try {
      assert.ok(columnNames(db).includes('reject_reason'));
      const row = db.prepare('SELECT * FROM expense_claims').get();
      assert.equal(row.status, 'rejected');
      assert.equal(row.reject_reason, null);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

const UNIQUE_INDEX = 'expense_claims_resubmitted_from_unique';

// 一意インデックスが resubmitted_from 列だけを対象にしていることを確かめる
function assertResubmittedFromUniqueIndex(db) {
  const index = db
    .prepare('PRAGMA index_list(expense_claims)')
    .all()
    .find((i) => i.name === UNIQUE_INDEX);
  assert.ok(index, `${UNIQUE_INDEX} がない`);
  assert.equal(index.unique, 1);
  assert.deepEqual(
    db.prepare(`PRAGMA index_info(${UNIQUE_INDEX})`).all().map((c) => c.name),
    ['resubmitted_from'],
  );
}

test('新規 DB に resubmitted_from 列と一意インデックスがある', () => {
  const db = openDatabase(':memory:');
  try {
    assert.ok(columnNames(db).includes('resubmitted_from'));
    assertResubmittedFromUniqueIndex(db);
  } finally {
    db.close();
  }
});

test('新規 DB に resubmit_note 列がある', () => {
  const db = openDatabase(':memory:');
  try {
    assert.ok(columnNames(db).includes('resubmit_note'));
  } finally {
    db.close();
  }
});

test('resubmitted_from のない旧スキーマの DB を開くと列（resubmit_note を含む）とインデックスが追加され、既存行は NULL になる', () => {
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
        decided_at   TEXT,
        reject_reason TEXT
      );
      INSERT INTO expense_claims
        (applicant_id, date, amount, description, status, created_at,
         decided_by, decided_at, reject_reason)
      VALUES
        ('u1', '2026-11-01', 1200, 'タクシー代', 'rejected',
         '2026-11-01T00:00:00.000Z', 'a1', '2026-11-02T00:00:00.000Z', '領収書がありません');
    `);
    assert.ok(!columnNames(old).includes('resubmitted_from'));
    old.close();

    const db = openDatabase(path);
    try {
      assert.ok(columnNames(db).includes('resubmitted_from'));
      assertResubmittedFromUniqueIndex(db);
      const row = db.prepare('SELECT * FROM expense_claims').get();
      assert.equal(row.status, 'rejected');
      assert.equal(row.reject_reason, '領収書がありません');
      assert.equal(row.resubmitted_from, null);
      assert.ok(columnNames(db).includes('resubmit_note'));
      assert.equal(row.resubmit_note, null);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resubmitted_from はあるが resubmit_note のない DB を開くと resubmit_note が追加され、既存行は NULL になる', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expense-db-'));
  try {
    const path = join(dir, 'partial.db');
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
        decided_at   TEXT,
        reject_reason TEXT,
        resubmitted_from INTEGER
      );
      CREATE UNIQUE INDEX expense_claims_resubmitted_from_unique
        ON expense_claims(resubmitted_from);
      INSERT INTO expense_claims
        (applicant_id, date, amount, description, status, created_at, resubmitted_from)
      VALUES
        ('u1', '2026-11-02', 1500, 'タクシー代', 'pending', '2026-11-03T00:00:00.000Z', 1);
    `);
    assert.ok(!columnNames(old).includes('resubmit_note'));
    old.close();

    const db = openDatabase(path);
    try {
      assert.ok(columnNames(db).includes('resubmit_note'));
      assertResubmittedFromUniqueIndex(db);
      const row = db.prepare('SELECT * FROM expense_claims').get();
      assert.equal(row.resubmitted_from, 1);
      assert.equal(row.resubmit_note, null);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resubmitted_from が NULL の行は複数挿入でき、同じ値の行は 2 つ挿入できない', () => {
  const db = openDatabase(':memory:');
  try {
    const insert = db.prepare(
      `INSERT INTO expense_claims (applicant_id, date, amount, description, created_at, resubmitted_from)
       VALUES ('u1', '2026-11-01', 1200, 'タクシー代', '2026-11-01T00:00:00.000Z', ?)`,
    );
    insert.run(null);
    insert.run(null);
    insert.run(1);
    assert.throws(() => insert.run(1), /UNIQUE constraint failed/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM expense_claims').get().n, 3);
  } finally {
    db.close();
  }
});

// リポジトリは errcode で一意制約違反を判定するため、node:sqlite のエラーの形を確かめておく
test('resubmitted_from の一意制約違反のエラーは errcode が SQLITE_CONSTRAINT_UNIQUE（2067）', () => {
  const db = openDatabase(':memory:');
  try {
    const insert = db.prepare(
      `INSERT INTO expense_claims (applicant_id, date, amount, description, created_at, resubmitted_from)
       VALUES ('u1', '2026-11-01', 1200, 'タクシー代', '2026-11-01T00:00:00.000Z', 1)`,
    );
    insert.run();
    assert.throws(
      () => insert.run(),
      (err) => {
        assert.equal(err.errcode, 2067);
        return true;
      },
    );
  } finally {
    db.close();
  }
});

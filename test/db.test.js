import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db.js';

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

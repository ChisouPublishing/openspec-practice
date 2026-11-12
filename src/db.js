import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS expense_claims (
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
`;

// 既存の DB ファイルに不足している列を追加する（CREATE TABLE IF NOT EXISTS は既存テーブルを変更しないため）
function addMissingColumns(db) {
  const columns = new Set(
    db.prepare('PRAGMA table_info(expense_claims)').all().map((c) => c.name),
  );
  if (!columns.has('reject_reason')) {
    db.exec('ALTER TABLE expense_claims ADD COLUMN reject_reason TEXT');
  }
}

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  addMissingColumns(db);
  return db;
}

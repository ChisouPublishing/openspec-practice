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
  reject_reason TEXT,
  resubmitted_from INTEGER,
  resubmit_note TEXT
);
`;

// ALTER TABLE ADD COLUMN では UNIQUE を付けられないため、列の追加後にインデックスで保証する。
// SQLite の UNIQUE は NULL 同士を重複とみなさないので、出し直しでない申請はいくつあってもよい
const RESUBMITTED_FROM_UNIQUE_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS expense_claims_resubmitted_from_unique
  ON expense_claims(resubmitted_from);
`;

// 既存の DB ファイルに不足している列を追加する（CREATE TABLE IF NOT EXISTS は既存テーブルを変更しないため）
function addMissingColumns(db) {
  const columns = new Set(
    db.prepare('PRAGMA table_info(expense_claims)').all().map((c) => c.name),
  );
  if (!columns.has('reject_reason')) {
    db.exec('ALTER TABLE expense_claims ADD COLUMN reject_reason TEXT');
  }
  if (!columns.has('resubmitted_from')) {
    db.exec('ALTER TABLE expense_claims ADD COLUMN resubmitted_from INTEGER');
  }
  if (!columns.has('resubmit_note')) {
    db.exec('ALTER TABLE expense_claims ADD COLUMN resubmit_note TEXT');
  }
}

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  addMissingColumns(db);
  db.exec(RESUBMITTED_FROM_UNIQUE_INDEX);
  return db;
}

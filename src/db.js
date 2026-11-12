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
  decided_at   TEXT
);
`;

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

# Design

## Context

- 現状は `src/app.js` の `buildApp()` が Fastify インスタンスを組み立て、`GET /health` だけを持つ。`src/server.js` が起動し、テストは `node --test` と `app.inject()` で行っている（`test/health.test.js`）。
- ESM（`"type": "module"`）、依存は `fastify` のみ。`engines.node` は `>=22.13` で、`node:sqlite`（`DatabaseSync`）は追加フラグなしで利用できる前提とする。
- 要件は `specs/expense-claims/spec.md` を参照。

## Goals / Non-Goals

**Goals:**
- テストごとに独立した DB を使えるよう、DB を `buildApp()` に注入できる構成にする
- 入力検証・権限チェック・状態遷移をルート層で一貫して扱う

**Non-Goals:**
- ORM やマイグレーションツールの導入
- DB 接続のプーリングや非同期化

## Decisions

### 1. `buildApp({ dbPath })` で DB の場所を指定する
`buildApp(options = {})` が `dbPath`（既定値 `':memory:'`）を受け取り、`DatabaseSync` を開く。`server.js` は環境変数 `DB_PATH`（既定 `data/expenses.db`）を渡す。Fastify の `onClose` フックで DB を閉じる。
- 代替案: モジュールレベルのシングルトン DB → テスト間で状態が共有されるため不採用。
- 既存の `buildApp()` 呼び出し（health テスト）は引数なしのまま動く。

### 2. モジュール構成
- `src/db.js`: `openDatabase(path)` でDBを開き、テーブルを `CREATE TABLE IF NOT EXISTS` で作成する。
- `src/expense-claims/repository.js`: `create` / `list({ applicantId })` / `findById` / `decide(id, status, approverId)` を提供。SQL はすべてプリペアドステートメント。
- `src/expense-claims/routes.js`: Fastify プラグインとしてルートを定義し、`app.js` で `register` する。
- 代替案: すべて `app.js` に書く → 小規模だが、DB アクセスとルートを分けた方がテストと読みやすさが良いので分割。

### 3. スキーマ
```sql
CREATE TABLE IF NOT EXISTS expense_claims (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id TEXT    NOT NULL,
  date         TEXT    NOT NULL,          -- YYYY-MM-DD
  amount       INTEGER NOT NULL CHECK (amount > 0),
  description  TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected')),
  created_at   TEXT    NOT NULL,          -- ISO 8601 (UTC)
  decided_by   TEXT,
  decided_at   TEXT
);
```
- 金額は円の整数で保持し、浮動小数点を避ける。
- API の応答はキャメルケース（`applicantId` など）に変換する。
- 一覧の並びは `ORDER BY created_at DESC, id DESC`（同時刻でも安定させるため `id` を併用）。

### 4. 状態遷移は条件付き UPDATE で行う
承認・差戻しは `UPDATE ... SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'` を実行し、`changes` が 0 なら `findById` で 404（存在しない）か 409（終端状態）かを判定する。
- 代替案: SELECT してから UPDATE → 判定と更新の間に別リクエストが割り込む余地があるため、条件付き UPDATE を採用。

### 5. 識別と権限は `preHandler` フックで行う
経費申請プラグイン内の `preHandler` で `X-User-Id` / `X-User-Role` を検証し、不正なら 401。`request.user = { id, role }` に格納する。各ルートで必要ロールと異なれば 403。
- チェック順は 401 → 403 → 400 / 404 → 409 とする（権限のない利用者に入力エラーや存在有無を返さない）。

### 6. 入力検証
Fastify の JSON Schema（`body` スキーマ）で型・必須・`amount` の `type: integer, minimum: 1`・`date` のパターン・`description` の長さを検証する。Fastify 既定の型変換（文字列 `"100"` → 数値）を避けるため、このルートでは型強制を無効にする（Ajv の `coerceTypes: false` をアプリ全体に設定）。実在日付のチェック（`2026-02-30` を拒否）と、`description` の前後空白除去後の長さチェックはハンドラ内で行い、400 を返す。`description` は trim した値を保存する。
- 代替案: すべて手書き検証 → Fastify の既存機能で済む部分はスキーマに任せる。

## Risks / Trade-offs

- [`node:sqlite` は Stability 1（実験的）で、読み込み時に ExperimentalWarning が出る / API が将来変わる可能性] → DB アクセスを `db.js` と repository に閉じ込め、影響範囲を限定する。警告は許容する。
- [ヘッダーによる識別はなりすましが可能] → 認証は本変更の対象外と明記済み。将来認証を入れる際は `preHandler` を差し替えるだけで済む構成にする。
- [`DatabaseSync` は同期 API のためリクエスト処理中にイベントループをブロックする] → 想定規模では問題にならない。
- [`data/` ディレクトリが存在しないと DB を開けない] → `server.js` 起動時にディレクトリを作成し、`data/` を `.gitignore` に追加する。

## Migration Plan

新規テーブルのみで既存データはない。起動時の `CREATE TABLE IF NOT EXISTS` で作成される。ロールバックはコードを戻し、DB ファイルを削除すればよい。

# Tasks

## 1. DB とアプリの土台

- [ ] 1.1 `src/db.js` に `openDatabase(path)` を実装し、`node:sqlite` の `DatabaseSync` で DB を開いて `expense_claims` テーブルを `CREATE TABLE IF NOT EXISTS` で作成する。`test/db.test.js` でインメモリ DB にテーブルが作られ、2 回呼んでもエラーにならないことを確認する
- [ ] 1.2 `buildApp({ dbPath = ':memory:' } = {})` に変更し、DB を開いて `onClose` で閉じる。Ajv の `coerceTypes` を無効にする。既存の `test/health.test.js` が引数なしのまま通ることを `npm test` で確認する
- [ ] 1.3 `src/server.js` で `DB_PATH`（既定 `data/expenses.db`）を渡し、`data/` ディレクトリがなければ作成する。`.gitignore` に `data/` を追加する。`npm start` で起動し `/health` が応答し、`data/expenses.db` が作られることを確認する

## 2. リポジトリ

- [ ] 2.1 `src/expense-claims/repository.js` に `create` / `list({ applicantId })` / `findById` を実装する（プリペアドステートメント、キャメルケースへの変換、`created_at DESC, id DESC` 順）。`test/expense-claims.repository.test.js` で作成・絞り込み・並び順を確認する
- [ ] 2.2 `decide(id, status, approverId)` を条件付き UPDATE で実装し、`updated` / `not_found` / `conflict` を区別して返す。同テストで 3 通りの結果を確認する

## 3. 識別と申請・一覧 API

- [ ] 3.1 `src/expense-claims/routes.js` をプラグインとして作成し `app.js` で登録する。`preHandler` で `X-User-Id` / `X-User-Role` を検証し、不正なら 401 を返す。`test/expense-claims.api.test.js` で「ヘッダーがない」「ロールが不正」のシナリオを確認する
- [ ] 3.2 `POST /expense-claims` を実装する（applicant 以外は 403、JSON Schema で型・必須・範囲を検証、実在日付と trim 後の `description` 長をハンドラで検証、成功時 201）。API テストで「申請に成功する」「承認者は申請できない」と「申請内容の検証」の全シナリオを確認する
- [ ] 3.3 `GET /expense-claims` を実装する（applicant は自分の申請のみ、approver は全件、新しい順）。API テストで「申請者は自分の申請だけを見る」「承認者はすべての申請を見る」「申請がない」を確認する

## 4. 承認・差戻し API

- [ ] 4.1 `POST /expense-claims/:id/approve` と `POST /expense-claims/:id/reject` を実装する（approver 以外は 403、`decide` の結果に応じて 200 / 404 / 409）。API テストで承認・差戻しの成功、申請者による 403、終端状態への 409、存在しない ID への 404 を確認する

## 5. 結合確認

- [ ] 5.1 一時ディレクトリのファイル DB で `buildApp` を起動して申請・承認し、`close` 後に同じパスで再度 `buildApp` して一覧に `approved` で残ることをテストで確認する（「再起動後も申請が残る」シナリオ）
- [ ] 5.2 `npm test` がすべて通り、`openspec validate add-expense-claims --strict` がエラーなく通ることを確認する

## Workflow follow-up

- レビュー後に `/opsx:archive` で変更をアーカイブする。

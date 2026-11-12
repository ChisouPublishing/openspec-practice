# Tasks

## 1. `resubmitted_from` 列と一意インデックス、`resubmit_note` 列

- [x] 1.1 `src/db.js` の `CREATE TABLE` に `resubmitted_from INTEGER` を加え、`addMissingColumns` で列がなければ `ALTER TABLE expense_claims ADD COLUMN resubmitted_from INTEGER` を実行する。列の追加の後に `CREATE UNIQUE INDEX IF NOT EXISTS expense_claims_resubmitted_from_unique ON expense_claims(resubmitted_from)` を実行する。`test/db.test.js` に次のテストを追加し、通ることを確認する: 新規 DB に `resubmitted_from` 列と一意インデックスがある／`resubmitted_from` のない旧スキーマのテーブル（`reject_reason` はあり、行あり）を開くと列とインデックスが追加され、既存行の値が `NULL` になる／`resubmitted_from` が `NULL` の行は複数挿入でき、同じ値の行を 2 つ挿入すると一意制約違反になる
- [x] 1.2 `src/db.js` の `CREATE TABLE` に `resubmit_note TEXT` を加え、`addMissingColumns` で列がなければ `ALTER TABLE expense_claims ADD COLUMN resubmit_note TEXT` を実行する（1.1 の `resubmitted_from` とは別に判定する）。`test/db.test.js` で次を確認する: 新規 DB に `resubmit_note` 列がある／1.1 で追加した旧スキーマのテスト（`resubmitted_from` のない DB）で `resubmit_note` も追加され、既存行の値が `NULL` になる／`resubmitted_from` はあるが `resubmit_note` のない DB（1.1 だけを反映したコードで作られた DB）を開くと `resubmit_note` が追加され、既存行の値が `NULL` になる

## 2. リポジトリでの出し直し

- [x] 2.1 `src/expense-claims/repository.js` の `insertStmt` に `resubmitted_from` を加え（`create` では `null`）、`toClaim` に `resubmittedFrom: row.resubmitted_from ?? null` を加える。`test/expense-claims.repository.test.js` に「`create` 直後の `resubmittedFrom` は `null`」を追加し、既存のテストとともに通ることを確認する
- [x] 2.2 2.1 で変更した `insertStmt` に `resubmit_note` を加え（`create` では `null`）、`toClaim` に `resubmitNote: row.resubmit_note ?? null` を加える。`test/expense-claims.repository.test.js` に「`create` 直後の `resubmitNote` は `null`」を追加し、既存のテストとともに通ることを確認する
- [x] 2.3 `resubmit(sourceId, applicantId, { date, amount, description, resubmitNote })` を追加する。`BEGIN IMMEDIATE`〜`COMMIT` の中で、元の申請がない・申請者が異なる → `not_found`、`rejected` でない → `conflict`（`reason: 'status'`）、出し直し済み → `conflict`（`reason: 'already_resubmitted'`）を判定し、通れば `resubmitted_from = sourceId`・`resubmit_note = resubmitNote` の `pending` を挿入して `created` を返す。一意インデックス違反も `already_resubmitted` として返し、例外時はロールバックする。`test/expense-claims.repository.test.js` に次のテストを追加し、通ることを確認する: 差戻した申請の出し直しで `created` と `resubmittedFrom`・`resubmitNote` が返り、元の申請は変わらない（元の申請の `resubmitNote` は `null` のまま）／存在しない ID と他人の申請は `not_found`（他人の `pending` の申請も `not_found`）／`pending`・`approved` は `conflict`（`status`）／2 回目は `conflict`（`already_resubmitted`）で行が増えない／出し直した申請を差戻すと、その申請から出し直せる

## 3. 出し直し API

- [x] 3.1 `src/expense-claims/routes.js` で、作成ルートのハンドラ内の検証（実在日付、`description` の trim 後の長さ）を関数に切り出し、作成ルートから呼ぶ形にする。挙動は変えず、既存の「経費の申請」「申請内容の検証」のテストがそのまま通ることを確認する
- [x] 3.2 `createBodySchema` の `properties` に `resubmitNote: { type: 'string' }`、`required` に `'resubmitNote'` を足した `resubmitBodySchema` を作る。`POST /expense-claims/:id/resubmit` を `preValidation: requireRole('applicant')` と `schema: { body: resubmitBodySchema }` で追加し、3.1 の関数で検証した後、`resubmitNote` を trim して 1〜`RESUBMIT_NOTE_MAX_LENGTH`（200、`description` とは別の定数）文字かを確かめ（不正なら 400）、`parseId`（不正なら 404）→ `repository.resubmit` の結果を 201 / 404 / 409 に変換する。409 のメッセージは `reason` で分ける（状態は既存と同じ文言、出し直し済みは「この申請はすでに出し直されています」）。`test/expense-claims.api.test.js` に仕様のシナリオに沿って次を追加し、`npm test` が通ることを確認する: 出し直しに成功する（201、新しい `id`、`applicantId`、`status`、`resubmittedFrom`、`resubmitNote`、`decidedBy`・`decidedAt`・`rejectReason` が `null`、送った値）／`resubmitNote` は前後の空白を除いて記録される／元の申請は差戻しのまま残る／承認者は 403／他人の申請は 404（他人の `pending` の申請も 404）／存在しない ID は 404／`amount` が `0` は 400／`description` がないと 400／`resubmitNote` がない・空白だけ・前後の空白を除いて 201 文字は 400／`resubmitNote` が 200 文字ちょうどは 201／存在しない ID に `date` が `2026-02-30` の本文で 400（404 ではない）／`pending` と `approved` は 409／2 回目の出し直しは 409 で 1 件だけのまま／出し直した申請が差戻されたら、さらに出し直せる
- [x] 3.3 `test/expense-claims.api.test.js` の「承認者はすべての申請を見る」で期待するキー一覧に `resubmittedFrom`・`resubmitNote` を加え、「出し直しの紐付けが一覧に含まれる」（出し直した申請の `resubmittedFrom` は元の `id`・`resubmitNote` は送ったメモ、元の申請はどちらも `null`）と「出し直された元の申請も承認できない」（409、`rejected` のまま）を追加して、`npm test` が通ることを確認する

## 4. 月ごとの集計

- [x] 4.1 `test/expense-claims.api.test.js` の「月ごとの集計」に「差戻した申請と出し直した申請は別々に数えられる」（`2026-11-15`・`2000` を差戻し、`2026-11-15`・`1800` で出し直し → `rejected` が `{"count":1,"totalAmount":2000}`、`pending` が `{"count":1,"totalAmount":1800}`）を追加する。集計のコードは変更せずに通ることを確認する

## 5. 結合確認

- [x] 5.1 `test/expense-claims.persistence.test.js` に、差戻した申請を出し直した後、同じ DB でサーバーを起動し直して一覧を取得すると、出し直した申請の `resubmittedFrom` と `resubmitNote` が保持され、同じ申請の再度の出し直しが 409 になるテストを追加し、`npm test` 全体が通ることを確認する
- [x] 5.2 `openspec validate allow-resubmit-rejected-claim` がエラーなく通ることを確認する

## Workflow follow-up

- レビュー後に `/opsx:archive` で変更をアーカイブし、`openspec/specs/expense-claims/spec.md` に差分が反映されていることを確認する。

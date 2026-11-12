# Tasks

## 1. リポジトリで月ごとに集計する

- [ ] 1.1 `src/expense-claims/repository.js` に `summarizeByMonth(month)` を追加する。`SELECT status, COUNT(*), COALESCE(SUM(amount), 0) FROM expense_claims WHERE substr(date, 1, 7) = ? GROUP BY status` を prepare し、`pending`・`approved`・`rejected` を `{ count: 0, totalAmount: 0 }` で初期化してから結果を当てはめ、`{ month, count, totalAmount, byStatus }`（全体は 3 状態の和）を返す。`test/expense-claims.repository.test.js` に次のテストを追加し、`npm test` が通ることを確認する: 状態ごとの件数と合計（`create` と `decide` で pending／approved／rejected を作る）、前月末（`2026-10-31`）と翌月初（`2026-12-01`）の申請が含まれない、複数の申請者の申請が合算される、該当なしの月は全体と 3 状態すべてが 0

## 2. 集計 API を追加する

- [ ] 2.1 `src/expense-claims/routes.js` に `GET /expense-claims/summary` を追加する。`preValidation: requireRole('approver')`、`schema.querystring` に `required: ['month']` と `month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }` を指定し、ハンドラは `repository.summarizeByMonth(request.query.month)` を返す。`test/expense-claims.api.test.js` に `describe('月ごとの集計')` を追加し、仕様のシナリオに沿って次を確認して `npm test` が通ることを確認する: 状態ごとに集計される（1000 承認・2000 差戻し・3000 未判断 → `count` 3、`totalAmount` 6000、各状態の内訳）、経費の日付で月を判定する（`2026-10-31`・`2026-12-01` は含まれない）、`u1` と `u2` の申請が両方含まれる、該当なしで全体と 3 状態が 0（ステータス 200）
- [ ] 2.2 `test/expense-claims.api.test.js` の `describe('月ごとの集計')` に権限と検証のテストを追加し、`npm test` が通ることを確認する: 申請者が `month=2026-11` で呼ぶと 403、申請者が `month` なしで呼ぶと 403（400 ではない）、承認者が `month` なしで 400、`2026-13`・`2026-00` で 400、`2026-1`・`2026/11`・`2026-11-01` で 400、ヘッダーなしで 401

## 3. 結合確認

- [ ] 3.1 `npm test` 全体が通り、既存の API テストが変更なしで通ることを確認する
- [ ] 3.2 `openspec validate add-monthly-summary --strict` がエラーなく通ることを確認する

## Workflow follow-up

- レビュー後に `/opsx:archive` で変更をアーカイブし、`openspec/specs/expense-claims/spec.md` に要件「月ごとの集計」「集計の権限」「集計する月の検証」が追加されていることを確認する。

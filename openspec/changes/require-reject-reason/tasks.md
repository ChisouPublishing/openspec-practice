# Tasks

## 1. 金額の上限

- [ ] 1.1 `src/expense-claims/routes.js` に `AMOUNT_MAX = 1_000_000` を定義し、`createBodySchema` の `amount` に `maximum: AMOUNT_MAX` を加える。`test/expense-claims.api.test.js` の「申請内容の検証」に「金額が上限を超える」（`1000001` → 400、申請が作成されない）と「金額が上限ちょうど」（`1000000` → 201）を追加し、`npm test` が通ることを確認する

## 2. `reject_reason` 列の追加

- [ ] 2.1 `src/db.js` の `CREATE TABLE` に `reject_reason TEXT` を追加し、`openDatabase` で `PRAGMA table_info(expense_claims)` に列がなければ `ALTER TABLE expense_claims ADD COLUMN reject_reason TEXT` を実行する。`test/db.test.js` に「新規 DB に `reject_reason` 列がある」テストと、「`reject_reason` のない旧スキーマのテーブル（行あり）を作った DB ファイルを `openDatabase` で開くと列が追加され、既存行の値が `NULL` になる」テストを追加し、通ることを確認する

## 3. リポジトリで理由を保存・返却する

- [ ] 3.1 `src/expense-claims/repository.js` の `toClaim` に `rejectReason: row.reject_reason ?? null` を加え、`decide(id, status, approverId, rejectReason = null)` の条件付き UPDATE で `reject_reason` も設定する。`test/expense-claims.repository.test.js` に「`create` 直後の `rejectReason` は `null`」「`decide(..., 'rejected', 'a1', '理由')` で `rejectReason` が記録される」「終端状態への `decide` は `conflict` を返し、既存の `rejectReason` を上書きしない」テストを追加し、通ることを確認する
- [ ] 3.2 `test/expense-claims.api.test.js` の「承認者はすべての申請を見る」で期待するキー一覧に `rejectReason` を加え、未判断の申請で `null` であることを確認するアサーションを追加して、`npm test` が通ることを確認する

## 4. 差戻し API で理由を必須にする

- [ ] 4.1 `src/expense-claims/routes.js` で `approve` と `reject` のルートを分け、ID 解析と `decide` の結果（404 / 409）を応答に変換する共通関数を用意する。`approve` は `decide(id, 'approved', userId)` のまま、挙動を変えない。既存の承認関連テストがそのまま通ることを確認する
- [ ] 4.2 `reject` ルートに body スキーマ（`reason` が必須の文字列）を付け、`REJECT_REASON_MAX_LENGTH = 500` を定義して、trim 後の長さ（コードポイント数）が 1〜500 でなければ 400 を返す。通過したら trim した理由を `decide(id, 'rejected', userId, reason)` に渡す。`npm test` で確認する（4.3 のテスト更新と合わせて通ること）
- [ ] 4.3 `test/expense-claims.api.test.js` の `decide` ヘルパーに本文を渡せるようにし、既存の差戻しを使うテスト（「差戻しに成功する」「承認済みの申請を差戻そうとする」「差戻し済みの申請を承認しようとする」「存在しない ID」）を有効な `reason` 付きに更新する。あわせて仕様のシナリオに沿って次を追加し、`npm test` が通ることを確認する: 差戻し成功時の `rejectReason`、理由の前後空白除去、理由なし／本文なし（400・`pending` のまま）、空文字・空白のみ（400）、数値の `reason`（400）、501 文字（400）、500 文字ちょうど（200）、申請者が差戻すと本文に関わらず 403、差戻し後に申請者の一覧で `rejectReason` が見える、承認済みの申請の `rejectReason` は `null`、差戻し済みの申請を別の理由で再度差戻すと 409 で理由が変わらない

## 5. 結合確認

- [ ] 5.1 `test/expense-claims.persistence.test.js` に、理由を付けて差戻した申請が再起動後も `rejected` と同じ `rejectReason` で返るテストを追加し、`npm test` 全体が通ることを確認する
- [ ] 5.2 `openspec validate require-reject-reason` がエラーなく通ることを確認する

## Workflow follow-up

- レビュー後に `/opsx:archive` で変更をアーカイブし、`openspec/specs/expense-claims/spec.md` に差分が反映されていることを確認する。

# Tasks

## 1. DB に取り下げの列を足す

- [ ] 1.1 `src/db.js` の `SCHEMA` に `withdrawn_at TEXT` を足し、`addMissingColumns` で列がなければ `ALTER TABLE expense_claims ADD COLUMN withdrawn_at TEXT` を実行する。`status` 列の CHECK は変えない（ADR-0006・ADR-0008）。`test/db.test.js` に「`withdrawn_at` のない古いスキーマの DB を開くと列が足され、既存の行は `NULL` のまま」のテストを足し、`npm test` が通ることを確認する

## 2. repository で実効の状態と取り下げを扱う

- [ ] 2.1 `src/expense-claims/repository.js` に実効の状態の SQL の式（`CASE WHEN withdrawn_at IS NOT NULL THEN 'withdrawn' ELSE status END`）を定数で 1 つ置き、`listStmt` の状態の条件と `summarizeByMonthStmt` の `SELECT`・`GROUP BY` をこの式に置き換える。`toClaim` は `withdrawn_at` があれば `status` を `withdrawn` にし、`withdrawnAt: row.withdrawn_at ?? null` を足す。`summarizeByMonth` の初期値に `withdrawn` を足す。`npm test` で既存のテストのうち `withdrawnAt` の追加と集計のキーの追加で落ちるものだけを直し、それ以外が変更なしで通ることを確認する
- [ ] 2.2 `decideStmt` の条件を `WHERE id = ? AND status = 'pending' AND withdrawn_at IS NULL` にする
- [ ] 2.3 `withdraw(id, applicantId)` を追加する。`UPDATE expense_claims SET withdrawn_at = ? WHERE id = ? AND applicant_id = ? AND status = 'pending' AND withdrawn_at IS NULL` を 1 文で実行し、`changes > 0` なら `{ result: 'updated', claim }`、0 なら `findById` で行がないか申請者が違えば `{ result: 'not_found' }`、それ以外は `{ result: 'conflict', claim }` を返す（ADR-0005）
- [ ] 2.4 `test/expense-claims.repository.test.js` に次のテストを足し、`npm test` が通ることを確認する: `withdraw` で `pending` の申請が `withdrawn` になり `withdrawnAt` が入る／他人・存在しない ID は `not_found`／`approved`・`rejected`・取り下げ済みは `conflict` で行は変わらない／取り下げた申請に `decide` すると `conflict`／取り下げた申請は `findById`・`list`（`status` なし・`withdrawn`・`pending`）・`summarizeByMonth` のすべてで `withdrawn` として扱われる

## 3. 取り下げ API

- [ ] 3.1 `src/expense-claims/routes.js` に `POST /expense-claims/:id/withdraw` を追加する。`preValidation: requireRole('applicant')`、本文のスキーマなし。`parseId` が `null` なら 404、`not_found` を 404、`conflict` を 409（`申請はすでに ${outcome.claim.status} のため変更できません`）、`updated` を 200 と更新後の申請に変換する
- [ ] 3.2 `test/expense-claims.api.test.js` に `describe('申請の取り下げ')` を足し、シナリオ「取り下げに成功する」のテストを書く（200、`status` が `withdrawn`、`withdrawnAt` が文字列、`decidedBy`・`decidedAt`・`rejectReason` が `null`、`date`・`amount`・`description` が申請時のまま）。`npm test` が通ることを確認する
- [ ] 3.3 同じ `describe` にシナリオ「取り下げた申請は一覧に残る」のテストを書く（取り下げ後の一覧が 200 で、その申請が `status: 'withdrawn'` で含まれる）。`npm test` が通ることを確認する
- [ ] 3.4 同じ `describe` にシナリオ「出し直した申請も取り下げられる」のテストを書く（申請 `2` の取り下げが 200、`resubmittedFrom` が申請 `1` の ID のまま、申請 `1` は `rejected` のまま）。`npm test` が通ることを確認する
- [ ] 3.5 `test/expense-claims.persistence.test.js` にシナリオ「再起動後も取り下げが残る」のテストを書く（同じ DB ファイルで起動し直した後の一覧が 200 で、`status` が `withdrawn`、`withdrawnAt` が設定されている）。`npm test` が通ることを確認する

## 4. 取り下げの権限

- [ ] 4.1 `test/expense-claims.api.test.js` に `describe('取り下げの権限')` を足し、シナリオ「承認者は取り下げられない」のテストを書く（403、申請は `pending` のまま）。`npm test` が通ることを確認する
- [ ] 4.2 同じ `describe` にシナリオ「他人の申請は取り下げられない」のテストを書く（`u2` が `u1` の `pending` の申請で 404、`pending` のまま）。`npm test` が通ることを確認する
- [ ] 4.3 同じ `describe` にシナリオ「他人の判断済みの申請も 404 になる」のテストを書く（`u2` が `u1` の `approved` の申請で 404）。`npm test` が通ることを確認する
- [ ] 4.4 同じ `describe` にシナリオ「存在しない申請を取り下げる」のテストを書く（存在しない数値の ID と `abc` のそれぞれで 404）。`npm test` が通ることを確認する

## 5. 取り下げできる申請

- [ ] 5.1 `test/expense-claims.api.test.js` に `describe('取り下げできる申請')` を足し、シナリオ「承認済みの申請は取り下げられない」のテストを書く（409、`status` が `approved`、`withdrawnAt` が `null` のまま、`message` が日本語）。`npm test` が通ることを確認する
- [ ] 5.2 同じ `describe` にシナリオ「差戻された申請は取り下げられない」のテストを書く（409、`status` が `rejected`、`rejectReason` が差戻し時の値のまま）。`npm test` が通ることを確認する
- [ ] 5.3 同じ `describe` にシナリオ「同じ申請を 2 回取り下げられない」のテストを書く（2 回目が 409、`withdrawnAt` が 1 回目の値のまま）。`npm test` が通ることを確認する

## 6. 既存の要件の変更（状態遷移・出し直し・一覧の項目）

- [ ] 6.1 `test/expense-claims.api.test.js` の「状態遷移の制約」に、シナリオ「取り下げた申請は承認できない」のテストを書く（409、`status` が `withdrawn`、`decidedBy`・`decidedAt` が `null` のまま）。`npm test` が通ることを確認する
- [ ] 6.2 同じ `describe` にシナリオ「取り下げた申請は差戻しできない」のテストを書く（有効な理由で 409、`status` が `withdrawn`、`rejectReason` が `null` のまま）。`npm test` が通ることを確認する
- [ ] 6.3 「出し直しできる申請」に、シナリオ「取り下げた申請は出し直せない」のテストを書く（409、申請の件数が増えない、`message` が `申請はすでに withdrawn のため変更できません`）。`npm test` が通ることを確認する
- [ ] 6.4 同じ `describe` にシナリオ「出し直した申請を取り下げても、元の申請はもう出し直せない」のテストを書く（申請 `2` を取り下げた後、申請 `1` の出し直しが 409 で申請の件数が増えない）。`npm test` が通ることを確認する
- [ ] 6.5 「申請の一覧」に、シナリオ「取り下げていない申請の取り下げ日時は null」のテストを書く（未判断・承認済み・差戻しの申請がすべて `withdrawnAt: null`）。作成・承認・差戻し・出し直しの応答の項目を確かめている既存のテストに `withdrawnAt: null` を足す。`npm test` が通ることを確認する

## 7. 一覧の絞り込みと検証

- [ ] 7.1 `src/expense-claims/routes.js` の `CLAIM_STATUSES` に `withdrawn` を足し、400 の `message` を `status は pending・approved・rejected・withdrawn のいずれか 1 つでなければなりません` にする。集計の初期値と同じ集合であることを示すコメントを保つ
- [ ] 7.2 「一覧の状態による絞り込み」に、シナリオ「取り下げた申請だけを見る」のテストを書く（`status=withdrawn` で 200、取り下げた申請だけ）。`npm test` が通ることを確認する
- [ ] 7.3 同じ `describe` にシナリオ「未判断で絞り込むと取り下げた申請は含まれない」のテストを書く（`status=pending` で 200、未判断の申請だけ）。`npm test` が通ることを確認する
- [ ] 7.4 同じ `describe` のシナリオ「指定しない場合はすべての状態を返す」のテストを、取り下げた申請を含む 4 件が返る形に直す。`npm test` が通ることを確認する
- [ ] 7.5 「絞り込む状態の検証」のシナリオ「大文字で指定する」に `status=WITHDRAWN` の 400 を、シナリオ「複数の状態を指定する」に `status=pending,withdrawn` の 400 を足す。`npm test` が通ることを確認する

## 8. 月ごとの集計

- [ ] 8.1 「月ごとの集計」のシナリオ「状態ごとに集計される」のテストに、`date` が `2026-11-20`・金額 `4000` の取り下げた申請を足し、`byStatus.withdrawn` が `{"count":1,"totalAmount":4000}` で、他の 3 状態が変わらないことを確かめる。`npm test` が通ることを確認する
- [ ] 8.2 シナリオ「該当する申請がない」のテストを、`byStatus` の 4 つのキーすべてが `{"count":0,"totalAmount":0}` である形に直す。`npm test` が通ることを確認する
- [ ] 8.3 シナリオ「取り下げた申請は未判断に数えない」のテストを書く（金額 `1000` と `500` のうち `500` を取り下げ、`pending` が `{"count":1,"totalAmount":1000}`、`withdrawn` が `{"count":1,"totalAmount":500}`）。`npm test` が通ることを確認する

## 9. 結合確認

- [ ] 9.1 npm test と openspec validate --strict の成功を確かめる（`npm test` 全体と `openspec validate allow-withdraw-pending-claim --strict` をそれぞれ単独で実行し、どちらもエラーなく通ることを確認する）

# Tasks

## 1. リポジトリで状態を絞り込む

- [x] 1.1 `src/expense-claims/repository.js` の `listAllStmt`・`listByApplicantStmt` を、`WHERE (:applicantId IS NULL OR applicant_id = :applicantId) AND (:status IS NULL OR status = :status) ORDER BY created_at DESC, id DESC` の 1 つの文に置き換え、`list({ applicantId, status } = {})` で `undefined` を `null` にして渡す。`test/expense-claims.repository.test.js` に次のテストを追加し、`npm test` が通ることを確認する: 状態だけを指定すると全申請者のその状態の申請が新しい順で返る、申請者と状態の両方を指定するとその申請者のその状態の申請だけが返る、どちらも指定しないと従来どおり全件が返る（既存の `list` のテストが変更なしで通る）

## 2. 一覧 API で状態を絞り込む

- [x] 2.1 `src/expense-claims/routes.js` に状態の定数（`pending`・`approved`・`rejected`）を追加し、`GET /expense-claims` のハンドラで `request.query.status` が `undefined` でなく、かつ「文字列で 3 つの値のいずれか」でない場合に `sendError(reply, 400, 'Bad Request', <日本語のメッセージ>)` を返す。検証を通った場合は `repository.list({ applicantId: role === 'applicant' ? id : undefined, status })` を返す。`npm test` で既存の「申請の一覧」のテストが変更なしで通ることを確認する
- [x] 2.2 `test/expense-claims.api.test.js` に `describe('一覧の状態による絞り込み')` を追加し、シナリオ「承認者が未判断の申請だけを見る」のテストを書く（`u1`・`u2` の未判断・承認済み・差戻しの申請を作り、承認者の `status=pending` で 200 と両者の未判断の申請だけが新しい順で返る）。`npm test` が通ることを確認する
- [x] 2.3 同じ `describe` にシナリオ「申請者は自分の申請の中から絞り込む」のテストを書く（`u1` の `status=approved` で 200 と `u1` の承認済みの申請だけが返り、`u2` の承認済みの申請は含まれない）。`npm test` が通ることを確認する
- [x] 2.4 同じ `describe` にシナリオ「差戻しで絞り込むと出し直された元の申請も含まれる」のテストを書く（`createRejected` と `resubmit` を使い、`status=rejected` で 200 と元の申請だけが返る）。`npm test` が通ることを確認する
- [x] 2.5 同じ `describe` にシナリオ「該当する申請がない」のテストを書く（未判断の申請だけがある状態で `status=approved` が 200 と空配列）。`npm test` が通ることを確認する
- [x] 2.6 同じ `describe` にシナリオ「指定しない場合はすべての状態を返す」のテストを書く（未判断・承認済み・差戻しの 3 件があり、`status` なしで 200 と 3 件が返る）。`npm test` が通ることを確認する

## 3. 絞り込む状態の検証

- [x] 3.1 `test/expense-claims.api.test.js` に `describe('絞り込む状態の検証')` を追加し、シナリオ「存在しない状態」のテストを書く（承認者の `status=draft` で 400、本文が `{ statusCode, error, message }` の形で `message` が日本語）。`npm test` が通ることを確認する
- [x] 3.2 同じ `describe` にシナリオ「空の値」のテストを書く（`status=` で 400）。`npm test` が通ることを確認する
- [x] 3.3 同じ `describe` にシナリオ「大文字で指定する」のテストを書く（`status=PENDING` で 400）。`npm test` が通ることを確認する
- [x] 3.4 同じ `describe` にシナリオ「複数の状態を指定する」のテストを書く（`status=pending&status=rejected` と `status=pending,rejected` のそれぞれで 400）。`npm test` が通ることを確認する
- [x] 3.5 同じ `describe` にシナリオ「ヘッダーがなく状態も不正」のテストを書く（ヘッダーなしの `status=draft` で 401）。`npm test` が通ることを確認する

## 4. 結合確認

- [x] 4.1 npm test と openspec validate --strict の成功を確かめる（`npm test` 全体と `openspec validate add-claim-status-filter --strict` をそれぞれ単独で実行し、どちらもエラーなく通ることを確認する）

## Workflow follow-up

- レビュー後に `/opsx:archive` で変更をアーカイブし、`openspec/specs/expense-claims/spec.md` に要件「一覧の状態による絞り込み」「絞り込む状態の検証」が追加されていることを確認する。

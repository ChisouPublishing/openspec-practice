# Proposal

## Why

現在の仕様では差戻し（`rejected`）は終端状態であり、差戻された申請者は内容を直して出し直す手段を持たない。差戻し理由は記録されるようになったが、それを受けて修正した申請を元の申請と結び付けて出す方法がなく、差戻しの経緯を追えない。差戻しの履歴（いつ・誰が・何を理由に差戻したか）を残したまま、申請者が直して出し直せるようにする。

## What Changes

- 差戻された申請を、申請者が内容を直して出し直す API `POST /expense-claims/:id/resubmit` を追加する。出し直すと、元の申請に紐付いた新しい申請（状態 `pending`）が作成される。
- 元の申請は `rejected` のまま変更しない。差戻しの理由・判断者・判断日時は元の申請に残る。
- 本文は `date`・`amount`・`description` の 3 項目すべてが必須で、`申請内容の検証` と同じ規則で検証する。本文の検証は元の申請の存在確認より先に行う。
- 出し直せるのは、自分の申請で状態が `rejected` のものだけ。承認者は 403、存在しない申請・他人の申請は 404、`rejected` でない申請は 409 とする。
- 1 つの申請から出し直せるのは 1 回だけとし、2 回目は 409 とする。出し直した申請がまた差戻された場合は、その申請からさらに出し直せる（回数の上限は設けない）。
- 申請を返すすべての API の応答に `resubmittedFrom`（元の申請の ID、出し直しでない申請は `null`）を加える。
- 月ごとの集計の計算は変えない。元の申請と出し直した申請はそれぞれ別の申請として数え、`rejected` の数字は「差戻しが起きた実績」を表すことをシナリオで明記する。
- 今回は扱わない: 元の申請側から出し直し先を示す `resubmittedTo`、申請の取下げ、一部の項目だけを指定する出し直し。

## Capabilities

### New Capabilities

（なし）

### Modified Capabilities

- `expense-claims`: 要件「差戻された申請の出し直し」「出し直しの権限」「出し直しの内容の検証」「出し直しできる申請」を新設する。「状態遷移の制約」を、`rejected` の申請に対してできる操作は出し直しだけ、という形に改める。「申請の一覧」で各申請が含む項目に `resubmittedFrom` を加える。「月ごとの集計」に、元の申請と出し直した申請を別々に数えることを明記する。

## Impact

- API: `POST /expense-claims/:id/resubmit` を追加。申請を返す全 API（作成・一覧・承認・差戻し・出し直し）の応答に `resubmittedFrom` が増える。既存の API の挙動は変わらない（項目の追加のみ）。
- コード: `src/expense-claims/routes.js`（出し直しルート、申請内容の検証の共通化）、`src/expense-claims/repository.js`（出し直しの作成と `resubmittedFrom` の返却）、`src/db.js`（`resubmitted_from` 列と一意インデックスの追加）。
- データ: 既存の DB ファイルに列とインデックスを追加する。既存の申請の `resubmittedFrom` は `null` になる。
- テスト: `test/expense-claims.api.test.js`、`test/expense-claims.repository.test.js`、`test/db.test.js`、`test/expense-claims.persistence.test.js` の更新・追加。
- 依存関係の追加はなし。

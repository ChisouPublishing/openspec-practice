# Proposal

## Why

承認者は現在、`GET /expense-claims` で申請を 1 件ずつ見ることしかできず、ある月の経費が全体でいくらか、承認待ちがどれだけ残っているかを知るには、クライアント側で一覧を絞り込んで足し上げる必要がある。月次の締めや承認状況の把握のために、承認者が月ごとの集計を API から直接得られるようにする。

## What Changes

- 新しい API `GET /expense-claims/summary?month=YYYY-MM` を追加する。承認者（`approver`）だけが呼べ、申請者（`applicant`）が呼ぶとステータス 403 を返す。
- 集計は、経費の日付（`date`）が指定した月に含まれる、すべての申請者の申請を対象とする（申請日時 `createdAt` ではない）。
- 応答には、指定した月と、状態（`pending`・`approved`・`rejected`）ごとの件数と金額合計を含める。差戻しの金額が合計に混ざらないよう、全体の件数・金額合計は返さない。該当する申請がない状態は件数・合計ともに 0 とする。
- クエリ `month` は必須で、実在する月を表す `YYYY-MM` 形式でなければならない。欠けている・不正な場合はステータス 400 を返す。
- 既存の API の挙動は変えない。

## Capabilities

### New Capabilities

（なし）

### Modified Capabilities

- `expense-claims`: 要件「月ごとの集計」「集計の権限」「集計する月の検証」を新設する。利用者の識別（401）は既存の要件「利用者の識別」がそのまま適用される。

## Impact

- API: `GET /expense-claims/summary` を追加。既存のエンドポイントに変更はない。
- コード: `src/expense-claims/routes.js`（ルートと `month` の検証）、`src/expense-claims/repository.js`（月ごとの集計クエリ）。
- データ: スキーマ変更なし。既存の `date` 列（`YYYY-MM-DD` の文字列）で月を判定する。
- テスト: `test/expense-claims.api.test.js`、`test/expense-claims.repository.test.js` に追加。
- 依存関係の追加はなし。

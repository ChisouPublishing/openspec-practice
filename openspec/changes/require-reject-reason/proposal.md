# Proposal

## Why

現在の経費申請 API には金額の上限がなく、桁の打ち間違いなど明らかに過大な申請もそのまま受け付けてしまう。また、差戻しの理由を残す手段がないため、申請者はなぜ差戻されたのかを知ることができず、再申請時に同じ誤りを繰り返しやすい。

## What Changes

- **BREAKING** 申請できる金額に 1 件あたり 1,000,000 円の上限を設ける。`amount` が 1,000,000 を超える申請はステータス 400 で拒否する（1,000,000 ちょうどは受け付ける）。
- **BREAKING** `POST /expense-claims/:id/reject` で、JSON 本文の `reason`（前後の空白を除いて 1〜500 文字の文字列）を必須にする。欠けている・不正な場合はステータス 400 を返し、申請の状態は変えない。
- 差戻し理由を申請に記録し、前後の空白を除いた値を `rejectReason` として返す。申請を返すすべての API（作成・一覧・承認・差戻し）の応答に `rejectReason` を含め、差戻されていない申請では `null` とする。
- 承認 API（`approve`）の挙動は変えない。

## Capabilities

### New Capabilities

（なし）

### Modified Capabilities

- `expense-claims`: 「申請内容の検証」に金額上限を追加し、「申請の差戻し」に理由の必須化と記録を追加する。あわせて「申請の一覧」で各申請が含む項目に `rejectReason` を加える。

## Impact

- API: `POST /expense-claims`（金額上限）、`POST /expense-claims/:id/reject`（本文 `reason` が必須に）、申請を返す全 API の応答に `rejectReason` を追加。差戻し API を本文なしで呼んでいる既存クライアントは 400 になる。
- コード: `src/expense-claims/routes.js`（検証・差戻しハンドラ）、`src/expense-claims/repository.js`（理由の保存と返却）、`src/db.js`（`reject_reason` 列の追加と既存 DB への列追加）。
- データ: 既存の DB ファイルに列を追加する必要がある。既存の差戻し済み申請の `rejectReason` は `null` になる。
- テスト: `test/expense-claims.api.test.js`、`test/expense-claims.repository.test.js`、`test/db.test.js` の更新・追加。
- 依存関係の追加はなし。

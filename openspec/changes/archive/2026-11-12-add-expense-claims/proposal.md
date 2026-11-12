# Proposal

## Why

現在の API は `/health` しかなく、経費精算の業務を扱えない。申請者が経費を申請し、承認者が承認・差戻しできる最小限の API を用意して、経費精算の流れをシステム上で完結させる。

## What Changes

- 経費申請（日付・金額・内容）を作成する API を追加する
- 申請の一覧を取得する API を追加する（申請者は自分の申請のみ、承認者はすべての申請）
- 承認者が申請を承認する API、差戻しする API を追加する
- 申請の状態は `pending`（申請中）→ `approved`（承認済み）または `rejected`（差戻し）の一方向のみとし、`approved` / `rejected` は終端状態とする。差戻し後に修正したい場合は新規に申請し直す
- 利用者は `X-User-Id` と `X-User-Role`（`applicant` / `approver`）ヘッダーで識別する。認証そのもの（ヘッダーの真正性の検証）は対象外
- データは Node.js 組み込みの `node:sqlite` に保存する（外部依存は追加しない）

対象外（Out of scope）:
- 認証・ユーザー管理
- 申請の編集・取消・削除
- 差戻し後の再申請（修正して `pending` に戻すこと）
- 添付ファイル（領収書）、通貨換算、ページング

## Capabilities

### New Capabilities
- `expense-claims`: 経費申請の作成・一覧・承認・差戻しと、申請状態の遷移ルール、利用者の識別と権限

### Modified Capabilities
（なし）

## Impact

- コード: `src/app.js` にルートを追加。経費申請のルートと SQLite へのデータアクセスを新規モジュールとして追加
- API: `POST /expense-claims`、`GET /expense-claims`、`POST /expense-claims/:id/approve`、`POST /expense-claims/:id/reject` を新設
- 依存: 追加なし（`node:sqlite` は Node.js 22.13 以上の組み込みモジュール。`package.json` の `engines` は既に `>=22.13`）
- データ: SQLite のデータベースファイルを新たに使用する（テストではインメモリ DB）

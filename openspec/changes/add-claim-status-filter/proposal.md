# Proposal

## Why

現在の `GET /expense-claims` は、承認者にはすべての申請を状態に関わらず返す。承認者がこれから判断すべき未判断（`pending`）の申請を探すには、すべての申請を受け取ってから自分で選り分けるしかなく、申請が増えるほど判断待ちの申請を見落としやすくなる。一覧を状態で絞り込めるようにし、判断待ちの申請だけを直接取得できるようにする。

## What Changes

- `GET /expense-claims` にクエリ `status`（`pending`・`approved`・`rejected` のいずれか 1 つ）を追加する。指定した場合は、その状態の申請だけを返す。
- 絞り込みは両方のロールで使える。申請者は自分の申請の中から、承認者はすべての申請の中から、指定した状態のものを返す（どの申請が見えるかは変わらない）。
- `status` を指定しない場合は、これまでどおり状態に関わらず返す（既存の呼び出し方は変わらない）。
- `status` の値が不正な場合（上記 3 つ以外、空文字、複数指定）は、ステータス 400 を返す。
- 並び順（作成日時の新しい順）と、各申請に含まれる項目は変えない。
- 出し直された元の申請は状態が `rejected` のままなので、`status=rejected` の結果に含まれる。

## 対象外

- 複数の状態をまとめて指定する絞り込み（例：`status=pending,rejected`）
- 状態以外の条件（申請者・日付・金額など）による絞り込み
- ページング・件数の上限・並び順の指定
- 月ごとの集計 API（`GET /expense-claims/summary`）の変更
- 「出し直されていない差戻し」だけを取り出すような、状態から派生する条件での絞り込み

## Capabilities

### New Capabilities

（なし）

### Modified Capabilities

- `expense-claims`: 申請の一覧をクエリ `status` で絞り込む要件と、その値の検証の要件を追加する。

## Impact

- API：`GET /expense-claims` が任意のクエリ `status` を受け付ける。指定しない呼び出しの応答は変わらないため、互換性は保たれる。
- コード：`src/expense-claims/routes.js`（クエリのスキーマとハンドラ）、`src/expense-claims/repository.js`（`list` に状態の条件を追加）
- テスト：`test/expense-claims.api.test.js`、`test/expense-claims.repository.test.js`
- データベースのスキーマと依存パッケージは変更しない。

# ADR-0001: データは node:sqlite に保存し、DB アクセスを repository に閉じ込める

- Status: accepted
- Date: 2026-11-12
- Supersedes: none
- Source: openspec/changes/archive/2026-11-12-add-expense-claims/design.md（Decisions 1〜3、Risks）

## Context

経費申請はサーバーを再起動しても残す必要がある（spec「データの永続化」）。依存パッケージは増やさない方針で、Node.js 22.13 以上では `node:sqlite`（`DatabaseSync`）を追加のフラグなしで使える。テストは `node --test` と `app.inject()` で行うため、テストごとに独立した DB が必要になる。

## Decision

- データは `node:sqlite` の `DatabaseSync` で SQLite に保存する。ORM やクエリビルダーは入れない。
- DB を扱うコードは次の 2 か所に限る。
  - `src/db.js`：DB を開き、スキーマを用意する（[ADR-0006](0006-additive-schema-evolution-at-startup.md) を参照）。
  - `src/expense-claims/repository.js`：SQL はすべてここに書き、プリペアドステートメントで実行する。
  ルート（`routes.js`）には SQL を書かない。
- DB の場所は `buildApp({ dbPath })` で受け取る。既定値は `:memory:` とする。`server.js` は環境変数 `DB_PATH`（既定 `data/expenses.db`）の値を渡す。DB は Fastify の `onClose` で閉じる。モジュールレベルのシングルトン DB は使わない。
- 保存と API での表し方は次のとおりとする。
  - 金額は円単位の整数（`INTEGER`）で持ち、浮動小数点は使わない。
  - 経費の日付は `YYYY-MM-DD` の文字列、記録日時（`createdAt`・`decidedAt`）は ISO 8601（UTC）の文字列とする。
  - DB の列名はスネークケース、API の応答のキーはキャメルケースとし、変換は repository の `toClaim` で行う。
  - 値がない項目は省略せず、`null` で返す。

## Consequences

- テストは `buildApp()` を引数なしで呼べば、他のテストと共有しない独立したメモリ上の DB を使える。
- `node:sqlite` は Stability 1（実験的）なので、読み込むと ExperimentalWarning が出る。API が将来変わる可能性もある。影響を受けるのは `db.js` と repository に限られる。
- `DatabaseSync` は同期 API なので、クエリの実行中はイベントループが止まる。今の規模では問題にならないが、1 プロセスから使う前提になる。
- 金額は整数なので、合計しても丸め誤差は出ない。
- 新しい項目を足すときは、列名をスネークケース、応答のキーをキャメルケース、値がない場合を `null` とする約束に従う。

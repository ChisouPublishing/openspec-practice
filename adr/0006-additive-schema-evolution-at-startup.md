# ADR-0006: スキーマは起動時に足す方向だけで変え、マイグレーションツールは使わない

- Status: accepted
- Date: 2026-11-12
- Supersedes: none
- Source: openspec/changes/archive/2026-11-12-require-reject-reason/design.md（Decisions 1・3、Migration Plan）、openspec/changes/archive/2026-11-12-allow-resubmit-rejected-claim/design.md（Decisions 4・5、Migration Plan）

## Context

`server.js` は `data/expenses.db` を使い続けるため、変更をデプロイしたときには古いスキーマの DB ファイルが残っている。最初の設計は `CREATE TABLE IF NOT EXISTS` だけで、既存のテーブルに列を足す仕組みはなかった。SQLite では、既存の列の制約を変えたり列に UNIQUE を付けたりするには、テーブルを作り直す必要がある。

## Decision

- スキーマは `src/db.js` の `openDatabase` が起動するたびに整える。
  - `CREATE TABLE IF NOT EXISTS` に最新の列をすべて書く。
  - `addMissingColumns` で `PRAGMA table_info` を確かめ、足りない列を `ALTER TABLE ... ADD COLUMN` で足す。
  - インデックスは、列を足した後に `CREATE [UNIQUE] INDEX IF NOT EXISTS` で作る。
- スキーマは足す方向にだけ変える。足す列は `NULL` を許し、既存の行は `NULL` のままにする。テーブルを作り直す変更（既存の列の CHECK を変える、列を削除する、など）は避ける。
- マイグレーションツールや `PRAGMA user_version` によるバージョン管理は入れない。
- 新しい入力の規則（例：金額の上限）は、DB の CHECK ではなくアプリの検証（[ADR-0004](0004-input-validation-split-schema-and-handler.md)）で守る。

## Consequences

- デプロイした後の最初の起動で、DB は自動的に新しいスキーマになり、DB ファイルを作り直さずに済む。
- ロールバックはコードを戻すだけで済む。古いコードは足された列を参照せず、INSERT でもその列を指定しないため `NULL` が入り、インデックスにも違反しない。新しい列を足すときは、このロールバックの性質を保つ。
- 既存のデータは新しい規則に合わない場合がある（例：上限を超える金額）。規則は新しく作成する申請にだけ適用する。
- 列の型の変更、データの変換、テーブルの作り直しが必要になった時点で、この方針の限界になる。そのときは、`user_version` などによるバージョン管理を入れる新しい ADR で、この ADR を置き換える。

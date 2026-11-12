# ADR-0004: 入力の検証は JSON Schema とハンドラで分担し、型の自動変換はしない

- Status: accepted
- Date: 2026-11-12
- Supersedes: none
- Source: openspec/changes/archive/2026-11-12-add-expense-claims/design.md（Decision 6）、openspec/changes/archive/2026-11-12-allow-resubmit-rejected-claim/design.md（Decision 1）、openspec/changes/archive/2026-11-12-add-claim-status-filter/design.md（Decisions「status はハンドラで検証する」）

## Context

Fastify には JSON Schema（Ajv）による検証が組み込まれているが、実在する日付かどうか、前後の空白を除いた長さといった規則はスキーマでは表せない。Fastify は既定で型を自動変換するため、文字列の `"100"` が数値として通ってしまう。

最初の変更（add-expense-claims）では「スキーマで表せるものはスキーマに任せる」とした。その後、一覧の絞り込み（add-claim-status-filter）で、スキーマ検証の 400 の `message` が英語になり、「message は日本語」という約束（[ADR-0003](0003-error-check-order-and-hook-placement.md)）に反することがわかった。そのため、スキーマに任せる範囲を狭めた。この ADR は、狭めた後の今の方針を書いたものである。

## Decision

- Ajv は `coerceTypes: false` でアプリ全体に設定する。型が違う値は変換せずに 400 にする。同じクエリを繰り返して値が配列になった場合も 400 になる。
- 本文とクエリのうち、型・必須・単純な範囲や形式の検証は JSON Schema で行う。例：`amount` の `integer`・`minimum`・`maximum`、`month` の `pattern`。
- 次の検証はハンドラの先頭で行い、日本語の `message` で 400 を返す。
  - スキーマで表せないもの：実在する日付かどうか、trim した後の文字数（コードポイントで数える）など。
  - 不正なときに利用者向けの日本語の `message` を返したいもの。例：一覧の `status` の値。
- 同じ規則を複数の API で使う場合は、定義を 1 か所にまとめて使い回す。例：作成と出し直しで `createBodySchema` と内容の検証関数を共有する。
- 文字列は trim した値を検証し、trim した値を保存する。

## Consequences

- 新しい入力項目を足すときは、型と必須はスキーマに、意味の検証と日本語のメッセージが要るものはハンドラに書く。
- スキーマ検証とハンドラ内の検証は、どちらも 404 の確認より前に動くため、確認の順番（[ADR-0003](0003-error-check-order-and-hook-placement.md)）を崩さない。
- 未解決の課題：作成 API と集計 API のスキーマ検証で返る 400 の `message` は英語のままで、一覧の 400 だけが日本語になっている。言語をそろえるかどうかは、別の変更で決める。
- 未知の本文の項目やクエリはエラーにせず、無視する。

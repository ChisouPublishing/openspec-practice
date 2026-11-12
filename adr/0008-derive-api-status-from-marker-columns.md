# ADR-0008: 新しい状態は目印の列で表し、API の状態は repository の 1 つの式で導く

- Status: accepted
- Date: 2026-11-13
- Supersedes: none
- Source: openspec/changes/allow-withdraw-pending-claim/design.md（Decisions 1〜4、Risks）

## Context

申請者による取り下げのために、新しい終端状態 `withdrawn` を API に足すことになった。DB の `expense_claims.status` 列には `CHECK (status IN ('pending','approved','rejected'))` が付いており、値を増やすにはテーブルを作り直す必要がある。[ADR-0006](0006-additive-schema-evolution-at-startup.md) はスキーマを足す方向にだけ変え、テーブルの作り直しを避けると決めている。[ADR-0007](0007-terminal-claims-are-immutable-resubmit-creates-new-row.md) は、申請を変える操作を足すときは新しい記録か新しい状態を足す方向で考えるとしている。

## Decision

- DB の `status` 列の値と CHECK は変えない。新しい状態は、NULL を許す目印の列（今回は `withdrawn_at`）を足して表す。目印の列には、その状態になった日時を入れる。
- API に返す状態（実効の状態）は、DB の `status` と目印の列から導く。今回の規則は `CASE WHEN withdrawn_at IS NOT NULL THEN 'withdrawn' ELSE status END`。
- 実効の状態の式は `src/expense-claims/repository.js` の 1 か所に定数で置き、一覧の絞り込み・集計など、状態を条件にする SQL はすべてこの式を使う。`toClaim` は同じ規則で応答の `status` を作る。
- 状態を変える条件付き UPDATE（[ADR-0005](0005-enforce-state-transitions-in-the-database.md)）は、`status = 'pending'` に加えて目印の列が `NULL` であることも条件にする。
- 目印の列の値は応答にキャメルケースの項目（今回は `withdrawnAt`）として返し、その状態でない申請では `null` にする（[ADR-0001](0001-persist-with-node-sqlite-behind-repository.md)）。

## Consequences

- テーブルを作り直さずに状態を足せる。列の追加は ADR-0006 の範囲に収まる。
- DB の `status` と API の `status` がずれる。DB を直接見るとき、または `status` を条件にする SQL を新しく書くときは、実効の状態の式を使う必要がある。`status = 'pending'` とだけ書くと、取り下げた申請も含まれてしまう。
- 古いコードにロールバックすると、目印の列は無視され、その状態の申請は元の `status`（今回は `pending`）に戻って見える。列の追加はロールバックしても壊れないが、状態の意味は失われる。
- 目印の列による状態が増えるほど、実効の状態の式と状態変更の条件が複雑になる。複数の目印の列が同時に `NULL` でなくなりうる状態を足す場合、またはこの方法で 2 つ目の状態を足す場合は、ADR-0006 を置き換えて `user_version` によるテーブルの作り直しを入れるかを検討する。

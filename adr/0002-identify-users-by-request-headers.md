# ADR-0002: 利用者はリクエストヘッダーで識別し、識別は onRequest フックに置く

- Status: accepted
- Date: 2026-11-12
- Supersedes: none
- Source: openspec/changes/archive/2026-11-12-add-expense-claims/design.md（Decision 5、Risks）、openspec/config.yaml

## Context

経費精算には申請者（`applicant`）と承認者（`approver`）の 2 つのロールがあり、API ごとに使えるロールが違う。認証の仕組みはこの作例の対象外とした。ただし、あとで認証を入れるときに作り直しが広がらないようにしておきたい。

## Decision

- 利用者は `X-User-Id`（空でない文字列）と `X-User-Role`（`applicant` または `approver`）の 2 つのヘッダーで識別する。ヘッダーが本物かどうかは確かめない。
- 識別は、経費申請の Fastify プラグインの `onRequest` フックで行う。ヘッダーがない、または値が不正な場合は 401 を返す。識別できた利用者は `request.user = { id, role }` に入れる。
- ロールの確認は、ルートごとの `preValidation`（`requireRole`）で行い、許されていないロールには 403 を返す。
- `/expense-claims` 配下のルートは、このプラグインにまとめて登録し、識別フックを共有する。

## Consequences

- 新しいルートは、同じプラグインに足せば識別の処理を書かなくても済む。ロールの制限は `preValidation: requireRole(...)` を付けるだけでよい。
- ヘッダーは誰でも偽れる。本番で使うには認証が必要になる。認証を入れるときは `onRequest` フックを差し替えて `request.user` を作るようにすれば、ルートは変えずに済む。
- 識別の 401 は、ロールの確認・入力の検証・存在の確認のどれよりも先に返る（順番は [ADR-0003](0003-error-check-order-and-hook-placement.md) を参照）。

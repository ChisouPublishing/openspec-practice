# ADR-0003: 確認の順番を 401 → 403 → 400 → 404 → 409 に固定し、フックの置き場所で守る

- Status: accepted
- Date: 2026-11-12
- Supersedes: none
- Source: openspec/changes/archive/2026-11-12-add-expense-claims/design.md（Decision 5）、openspec/changes/archive/2026-11-12-require-reject-reason/design.md（Decision 2）、openspec/changes/archive/2026-11-12-allow-resubmit-rejected-claim/design.md（Decision 1）、openspec/config.yaml

## Context

1 つのリクエストに複数の誤りがあるとき、どのステータスを返すかが API ごとに違うと、クライアントは判定できない。権限のない利用者に入力の誤りや申請があるかどうかを返すと、本来見せない情報が漏れる。Fastify は `onRequest` → 本文の解析 → `preValidation` → スキーマ検証 → `preHandler` → ハンドラの順に処理するため、確認をどのフックに置くかで返る順番が決まる。

## Decision

- すべての経費申請 API で、確認は次の順に行う。
  - 401：識別（`onRequest`）
  - 403：ロール（`preValidation`）
  - 400：入力。スキーマ検証とハンドラ内の検証
  - 404：存在。他人の申請も含む
  - 409：状態
- ロールの確認は、スキーマ検証より前に動く `preValidation` に置く。`preHandler` には置かない。
- 本文やクエリの検証は、DB で申請の有無を確かめる前に行う。存在しない ID に不正な本文を送った場合は 400 を返す。
- 他人の申請は、その状態に関わらず「存在しない」として 404 を返す。他人の申請があるかどうか、どの状態かは見せない。
- エラーの応答は `{ statusCode, error, message }` の形とし、`message` は日本語で書く。

## Consequences

- 新しい API もこの順番に従う。spec のシナリオで順番を確かめる（例：「申請者が不正な月で呼ぶ → 403」「存在しない申請に不正な理由で差戻す → 400」）。
- 申請者は「存在しない申請」と「他人の申請」を区別できない。これは意図した挙動で、一覧に他人の申請を出さないこととも一致する。
- 既知の例外：`Content-Type: application/json` で本文が空または壊れている場合は、本文の解析が `preValidation` より前に走るため、403 より先に 400 が返る。既存のすべての本文付き API に共通する挙動として、今は扱わない。
- スキーマ検証で返る 400 の `message` は Fastify の既定のままで英語になり、「message は日本語」という約束とずれている（[ADR-0004](0004-input-validation-split-schema-and-handler.md) を参照）。

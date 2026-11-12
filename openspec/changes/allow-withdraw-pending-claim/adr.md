# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-13
- Reviewer: Claude（opsx:propose）
- Change: allow-withdraw-pending-claim

## In-Force ADR Context Reviewed

- adr/0001-persist-with-node-sqlite-behind-repository.md - SQL は repository に置く。新しい列はスネークケース、応答はキャメルケースで値がなければ `null`（`withdrawn_at` → `withdrawnAt`）
- adr/0002-identify-users-by-request-headers.md - 取り下げルートも同じプラグインに置き、`requireRole('applicant')` を付ける
- adr/0003-error-check-order-and-hook-placement.md - 401 → 403 → 404 → 409 の順。他人の申請は状態に関わらず 404
- adr/0004-input-validation-split-schema-and-handler.md - 取り下げは本文を受け取らず、未知の本文は無視する
- adr/0005-enforce-state-transitions-in-the-database.md - 取り下げは条件付き UPDATE 1 文。承認・差戻しの条件に取り下げを加える
- adr/0006-additive-schema-evolution-at-startup.md - `withdrawn_at` 列を `addMissingColumns` で足す。CHECK は変えず、テーブルは作り直さない（置き換えない）
- adr/0007-terminal-claims-are-immutable-resubmit-creates-new-row.md - `withdrawn` を新しい終端状態として足す。終端状態の申請は書き換えない

置き換えられた ADR はない（ADR-0001〜0007 はすべて in-force）。

## Repository-Level ADRs Created

- adr/0008-derive-api-status-from-marker-columns.md - 新しい状態は NULL 可の目印の列で表し、API の状態は repository の 1 つの式で DB の `status` と目印の列から導く

## Notes

- ADR-0008 は ADR-0006 と両立し、置き換えない。目印の列による状態がさらに増える場合の見直しの条件を ADR-0008 の Consequences に書いた。

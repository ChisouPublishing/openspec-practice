# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-13
- Reviewer: Claude（/opsx:propose）
- Change: split-long-list-and-summary-requirements

## In-Force ADR Context Reviewed

- adr/0001-persist-with-node-sqlite-behind-repository.md - 値がない項目を `null` で返す約束。「一覧の申請の項目」の `null` の規則はこれに沿ったまま変えない
- adr/0002-identify-users-by-request-headers.md - 関係なし（識別の仕組みは変えない）
- adr/0003-error-check-order-and-hook-placement.md - 関係なし（確認の順番は変えない）
- adr/0004-input-validation-split-schema-and-handler.md - 関係なし（入力の検証は変えない）
- adr/0005-enforce-state-transitions-in-the-database.md - 関係なし（状態の変更は変えない）
- adr/0006-additive-schema-evolution-at-startup.md - 関係なし（スキーマは変えない）
- adr/0007-terminal-claims-are-immutable-resubmit-creates-new-row.md - 出し直しと元の申請を別々に数える判断。「集計での取り下げと出し直しの扱い」はこれをそのまま書いたもの。Source 欄の要件名「月ごとの集計」は古くなるが、ADR は変更しない
- adr/0008-derive-api-status-from-marker-columns.md - 取り下げた申請を `withdrawn` として数える実効の状態の式。集計の振る舞いは変えない

8 件とも Supersedes は none で、すべて有効。

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

- この変更は仕様の要件の分け方と名前を変えるだけで、アーキテクチャの判断を伴わない。
- 「500 文字を超えた要件は分ける」は OpenSpec の検証の規則であり、このリポジトリ独自の長期的な判断ではないため、ADR にしない。

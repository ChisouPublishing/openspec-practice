# ADR-0007: 終端状態の申請は書き換えず、出し直しは新しい申請として作ってつなぐ

- Status: accepted
- Date: 2026-11-12
- Supersedes: none
- Source: openspec/changes/archive/2026-11-12-allow-resubmit-rejected-claim/design.md（Decisions 1〜3、Risks）、openspec/specs/expense-claims/spec.md（「状態遷移の制約」「月ごとの集計」「一覧の状態による絞り込み」）

## Context

最初の設計では、`approved` と `rejected` は終端状態で、承認や差戻しをやり直す道はなかった。差戻された申請を直して出し直せるようにするには、次の 2 つの方法がある。

- 元の申請を `pending` に戻して書き換える。
- 新しい申請を作る。

書き換えると、誰が何を理由に差戻したかという記録が消え、月ごとの集計から差戻しの実績もなくなる。

## Decision

- `approved` と `rejected` は終端状態のままとし、その申請の状態・`decidedBy`・`decidedAt`・`rejectReason` は二度と書き換えない。
- 出し直しは専用のルート `POST /expense-claims/:id/resubmit` で、新しい `pending` の申請を作る。新しい申請の `resubmitted_from` には元の申請の `id` を、`resubmit_note` には直した内容のメモを記録する。作成 API（`POST /expense-claims`）には混ぜない。
- 1 つの申請から出し直せるのは 1 回までとする（一意性の保証は [ADR-0005](0005-enforce-state-transitions-in-the-database.md)）。出し直した申請がまた差戻された場合は、その申請から出し直せる。つまり申請は鎖のようにつながる。
- 集計・一覧・絞り込みでは、元の申請と出し直した申請をそれぞれ独立した申請として、各自の状態で扱う。

## Consequences

- 差戻しの記録（理由・判断した人・日時）がすべて残り、`byStatus.rejected` は差戻しの実績を表す。
- 同じ経費の金額が、`rejected` と `pending`／`approved` の両方に現れる。月の経費額を出すクライアントは、状態を選んで合計する必要がある。
- つながりは子から親への 1 方向（`resubmittedFrom`）しかない。元の申請から出し直し先をたどる API（`resubmittedTo` など）は、必要になったときに別の変更で足す。
- 今後、申請を変える操作を足すときも、終端状態の申請を書き換えず、新しい記録を作るか新しい状態を足す方向で考える。

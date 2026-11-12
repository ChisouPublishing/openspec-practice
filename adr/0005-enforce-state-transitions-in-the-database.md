# ADR-0005: 状態の変更は DB 側で原子的に行い、競合の判定を DB に任せる

- Status: accepted
- Date: 2026-11-12
- Supersedes: none
- Source: openspec/changes/archive/2026-11-12-add-expense-claims/design.md（Decision 4）、openspec/changes/archive/2026-11-12-allow-resubmit-rejected-claim/design.md（Decisions 2・4）

## Context

承認・差戻し・出し直しは、どれも「今の状態がこうなら変更する」という操作である。SELECT で状態を確かめてから UPDATE や INSERT をすると、その間に別のリクエストが割り込み、二重に承認されたり、1 つの申請が 2 回出し直されたりするおそれがある。

## Decision

- 状態の変更は、確認と更新を 1 つの原子的な操作として DB で行う。
  - 行を更新するだけの操作（承認・差戻し）は、条件付き UPDATE（`... WHERE id = ? AND status = 'pending'`）を 1 文で実行する。`changes` が 0 なら、`findById` で 404 か 409 かを決める。
  - 新しい行を作る操作（出し直し）は、判定と INSERT を `BEGIN IMMEDIATE` 〜 `COMMIT` で囲む。
- アプリの判定に加えて、守らなければならない一意性は DB のインデックスでも保証する。例：`resubmitted_from` の一意インデックス。インデックス違反（`SQLITE_CONSTRAINT_UNIQUE`）は、通常の 409 の分岐として扱う。
- repository は HTTP を知らず、`updated`／`created`／`not_found`／`conflict`（必要なら `reason` を付ける）の結果を返す。ステータスコードとメッセージへの変換はルートで行う。

## Consequences

- 同時にリクエストが来ても、終端状態の申請が書き換わったり、出し直しが重複したりしない。
- 新しく状態を変える操作を足すときは、同じやり方（条件付き UPDATE かトランザクション）に従い、repository の結果の種類を使う。
- 外部キーなどの参照の制約は DB では強制せず、API を通るときに存在を確かめる。DB を直接操作した場合の整合性は保証しない。
- 1 プロセスから `DatabaseSync` を使う前提（[ADR-0001](0001-persist-with-node-sqlite-behind-repository.md)）で成り立っている。複数のプロセスや別の DB に移す場合は、この判断を見直す必要がある。

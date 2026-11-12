# Design

## Context

- 動機は proposal.md（Why）、要件は `specs/expense-claims/spec.md` を参照。
- 現状の `src/expense-claims/routes.js` は、`approve` と `reject` を 1 つのループで同じハンドラとして登録しており、本文を受け取らない。入力検証は `POST /expense-claims` の body スキーマ（`amount: { type: 'integer', minimum: 1 }`）とハンドラ内のチェック（実在日付、`description` の trim 後の長さ）の組み合わせで行っている。
- `src/db.js` はテーブルを `CREATE TABLE IF NOT EXISTS` で作成するだけで、既存テーブルへの列追加の仕組みはない。`server.js` は `data/expenses.db` を使うため、既存の DB ファイルが残っている可能性がある。
- 識別・権限のチェック順は 401 → 403 → 400 / 404 → 409（前回の設計で決定）。本文スキーマ検証は `preValidation`（ロール確認）の後に走る。

## Goals / Non-Goals

**Goals:**
- 既存の DB ファイルを作り直さずに `reject_reason` 列を追加できるようにする
- 金額上限と差戻し理由の検証を、既存の検証方式（スキーマ＋ハンドラ内チェック）に揃える

**Non-Goals:**
- マイグレーションツールやスキーマバージョン管理の導入
- DB 側の `CHECK` 制約で金額上限を強制すること
- 承認時のコメントや、差戻し理由の編集・履歴

## Decisions

### 1. 金額上限は body スキーマの `maximum` で検証する
`createBodySchema` の `amount` を `{ type: 'integer', minimum: 1, maximum: 1000000 }` にする。上限値は `AMOUNT_MAX = 1_000_000` として定数化する。
- 代替案: ハンドラ内で比較 → 型・下限と同じくスキーマで表現できるため、宣言的に書けるスキーマを選ぶ。
- 代替案: DB の `CHECK (amount <= 1000000)` を追加 → SQLite では既存テーブルの `CHECK` を変更するのにテーブル再作成が必要になり、既存データに上限超過の行があると移行に失敗する。上限は「新規申請の受け付けルール」なのでアプリ層に置く。

### 2. 差戻しルートを承認ルートから分け、本文スキーマを付ける
`approve` と `reject` を共通ループから外し、共通部分（ID の解析、`decide` の結果から 404 / 409 への変換）を小さな関数にまとめたうえで、`reject` にだけ body スキーマ `{ type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } }` を付ける。trim 後の長さ（1〜500 文字、`[...s].length` でコードポイント数を数える）はハンドラ内で検証し、`description` と同じ方式に揃える。`REJECT_REASON_MAX_LENGTH = 500` を定数化する。
- 本文がない・`reason` が文字列でない場合はスキーマ検証で 400 になる。`coerceTypes: false` のため数値 `123` は文字列に変換されず 400 になる。
- チェック順: 403（ロール）→ 400（本文）→ 404（存在しない）→ 409（終端状態）。本文の検証は DB を見る前に行うので、存在しない ID に不正な本文を送ると 400 になる（仕様の要件「差戻しの検証の順序」）。既存の「400 / 404 は同順位」の方針とも矛盾しない。
- 代替案: ループのまま `action === 'reject'` で分岐 → スキーマの有無がルートごとに違うため、分けた方が読みやすい。

### 3. `reject_reason` 列を追加し、起動時に不足していれば `ALTER TABLE` する
`CREATE TABLE` に `reject_reason TEXT` を加える。さらに `openDatabase` で `PRAGMA table_info(expense_claims)` を確認し、列がなければ `ALTER TABLE expense_claims ADD COLUMN reject_reason TEXT` を実行する。既存行は `NULL` になる。
- 代替案: スキーマバージョンを `PRAGMA user_version` で管理 → 列 1 つの追加には過剰。今後変更が増えたら導入を検討する。
- 代替案: DB ファイルを削除して作り直す運用 → 既存データが失われるため不採用。

### 4. リポジトリの `decide` に理由を渡す
`decide(id, status, approverId, rejectReason = null)` とし、条件付き UPDATE で `reject_reason` も同時に設定する（`WHERE id = ? AND status = 'pending'` は維持）。承認時は `null` を渡す。`toClaim` は `rejectReason: row.reject_reason ?? null` を返す。
- 条件付き UPDATE のままなので、終端状態の申請に差戻しを行っても理由は上書きされない（409 のシナリオを満たす）。
- 代替案: `reject(id, approverId, reason)` を別メソッドにする → 状態遷移ロジックが 2 か所に分かれるため、既存の `decide` を拡張する。

## Risks / Trade-offs

- [差戻し API を本文なしで呼ぶ既存クライアントが 400 になる] → proposal で BREAKING と明記。クライアント側で `reason` を送るよう改修が必要。
- [Content-Type が `application/json` で本文が空・壊れている場合、Fastify の本文解析は `preValidation` より前に走るため、申請者ロールでも 403 より先に 400 が返る] → 既存の `POST /expense-claims` と同じ挙動であり、本変更では扱わない。
- [既存データに 1,000,000 円を超える申請が残っていても、そのまま一覧・承認できる] → 上限は作成時のルールとして扱い、既存データは変更しない。
- [`ALTER TABLE` を起動時に毎回確認するコスト] → `PRAGMA table_info` 1 回のみで無視できる。

## Migration Plan

1. デプロイ後の初回起動で `openDatabase` が `reject_reason` 列を追加する（既存の差戻し済み申請の `rejectReason` は `null`）。
2. ロールバック時はコードを戻せばよい。追加された列は旧コードからは参照されず、`SELECT *` の結果に余分な列があっても旧 `toClaim` は無視するため、DB を戻す必要はない。

# Design

## Context

- 動機は proposal.md（Why）、要件は `specs/expense-claims/spec.md` を参照。
- `src/expense-claims/routes.js` は、申請の作成時に body スキーマ（`createBodySchema`）とハンドラ内のチェック（実在日付、`description` の trim 後の長さ）を組み合わせて検証している。ハンドラ内のチェックは作成ルートの中に直接書かれている。
- 権限の確認は `preValidation` の `requireRole` で行い、スキーマ検証より先に動く。チェック順は 401 → 403 → 400 → 404 → 409 で、差戻し API では本文の検証を存在確認より先に行っている。
- `src/expense-claims/repository.js` の状態変更は `decide` の条件付き UPDATE（`WHERE id = ? AND status = 'pending'`）だけで、結果を `updated` / `not_found` / `conflict` で返し、ルート側で 404 / 409 に変換している。
- `src/db.js` は `CREATE TABLE IF NOT EXISTS` に加え、`addMissingColumns` で不足している列を `ALTER TABLE ADD COLUMN` で追加する仕組みを持つ。`status` には `CHECK` 制約があるが、今回は状態を増やさないので変更しない。
- DB は `node:sqlite` の `DatabaseSync`（同期 API）で、1 プロセスから使う。

## Goals / Non-Goals

**Goals:**
- 申請時と出し直し時で、本文の検証規則が 1 か所の定義を共有するようにする
- 「1 つの申請から出し直せるのは 1 回」を、アプリの判定に加えて DB でも保証する
- 既存の DB ファイルを作り直さずに列とインデックスを追加する

**Non-Goals:**
- `resubmitted_from` への外部キー制約（SQLite は既定で外部キーを強制せず、存在の確認はアプリで行う）
- 元の申請から出し直し先を引く API や項目（`resubmittedTo`）
- `PRAGMA user_version` によるスキーマバージョン管理の導入
- 月ごとの集計のコード変更（要件の計算は変わらない）

## Decisions

### 1. 出し直しは専用ルート `POST /expense-claims/:id/resubmit` にし、作成と同じ body スキーマを使う
ルートは `preValidation: requireRole('applicant')` と `schema: { body: createBodySchema }` で登録する。ハンドラ内の検証（実在日付、`description` の trim 後の長さ）は、作成ルートから関数（例: 正規化した値か 400 のメッセージを返す関数）として切り出し、作成と出し直しの両方から呼ぶ。
- チェック順: 403（ロール）→ 400（スキーマ・ハンドラ内の検証）→ 404（ID の形式が不正・申請がない・他人の申請）→ 409（`rejected` でない・出し直し済み）。本文の検証は DB を見る前に行うので、存在しない ID に不正な本文を送ると 400 になる。
- 代替案: `POST /expense-claims` に `resubmittedFrom` を足す → 作成 API の要件に 404 / 409 の分岐が入り込み、承認・差戻しの `:id` 形式とも揃わないため不採用（探索で決定済み）。
- 代替案: 検証をルートごとに書く → 規則が 2 か所に分かれ、片方だけ変更される恐れがあるため共通化する。

### 2. リポジトリに `resubmit` を追加し、判定と作成を 1 つのトランザクションで行う
`resubmit(sourceId, applicantId, { date, amount, description })` を追加し、`{ result: 'created', claim }`、`{ result: 'not_found' }`、`{ result: 'conflict', reason }` のいずれかを返す。
- 元の申請がない、または `applicant_id` が `applicantId` と異なる → `not_found`（他人の申請の存在を明かさないため、状態より先に判定する）
- 状態が `rejected` でない → `conflict`（`reason: 'status'`）
- その申請を `resubmitted_from` に持つ行がすでにある → `conflict`（`reason: 'already_resubmitted'`）
- それ以外 → `resubmitted_from = sourceId` で `pending` の行を挿入して `created`

判定と挿入は `BEGIN IMMEDIATE` 〜 `COMMIT` で囲む。挿入時に一意インデックス違反（`SQLITE_CONSTRAINT_UNIQUE`）が起きた場合も `already_resubmitted` の `conflict` として返す。ルートは `conflict` を 409 に変換し、メッセージを `reason` で分ける（状態の場合は既存と同じ「申請はすでに ○○ のため変更できません」、出し直し済みの場合は「この申請はすでに出し直されています」）。
- 代替案: `decide` のような条件付き UPDATE 1 文で済ませる → 出し直しは元の行を更新せず新しい行を挿入するので、同じ方式は使えない。
- 代替案: 一意インデックスだけに頼り、事前の確認をしない → 状態と申請者の判定はいずれにせよ必要で、インデックス違反の例外を通常の分岐に使うより読みやすいため、事前確認を主、インデックスを最後の防御とする。

### 3. 申請の作成処理は共通の挿入文を使い、`resubmitted_from` を引数に取る
既存の `insertStmt` に `resubmitted_from` を加え、通常の `create` では `null`、`resubmit` では元の申請の `id` を渡す。`toClaim` は `resubmittedFrom: row.resubmitted_from ?? null` を返す。これで作成・一覧・承認・差戻し・出し直しのすべての応答に `resubmittedFrom` が入る。
- 代替案: 出し直し専用の挿入文を用意する → 列の並びが 2 か所に分かれるため、1 つにまとめる。

### 4. `resubmitted_from` 列と一意インデックスを起動時に追加する
`CREATE TABLE` に `resubmitted_from INTEGER` を加え、`addMissingColumns` で既存 DB にも `ALTER TABLE expense_claims ADD COLUMN resubmitted_from INTEGER` を追加する。そのうえで `openDatabase` で列の追加の後に `CREATE UNIQUE INDEX IF NOT EXISTS expense_claims_resubmitted_from_unique ON expense_claims(resubmitted_from)` を実行する。
- SQLite の UNIQUE は `NULL` 同士を重複とみなさないので、出し直しでない申請（`NULL`）がいくつあっても問題ない。
- `ALTER TABLE ADD COLUMN` では列に UNIQUE 制約を付けられないため、インデックスを別に作る。インデックスは列の追加より後に作る必要がある（旧スキーマの DB では列がまだないため）。
- 代替案: テーブルを作り直して列に UNIQUE を付ける → 既存データのコピーが必要になり、列 1 つの追加には過剰。

## Risks / Trade-offs

- [元の申請と出し直した申請が両方集計されるため、同じ経費の金額が `rejected` と `pending`／`approved` の両方に現れる] → 「差戻しの実績」として読むことを仕様のシナリオで明記した（ユーザー確認済み）。
- [他人の申請を 404 にするため、申請者は「存在しない」と「他人のもの」を区別できない] → 意図した挙動。申請者向けの一覧に他人の申請が出ないことと揃えている。
- [出し直し API に対し、Content-Type が `application/json` で本文が壊れている場合、本文解析が `preValidation` より前に走るため承認者でも 403 より先に 400 が返る] → 既存の `POST /expense-claims` と同じ挙動であり、本変更では扱わない。
- [`resubmitted_from` に外部キー制約がないため、DB を直接操作すると存在しない ID を指す行を作れる] → API 経由では必ず存在確認を通る。直接操作は想定しない。

## Migration Plan

1. デプロイ後の初回起動で `openDatabase` が `resubmitted_from` 列と一意インデックスを追加する。既存の申請の `resubmittedFrom` は `null` になる。
2. ロールバック時はコードを戻せばよい。旧コードは `resubmitted_from` を参照せず、挿入時にも指定しないので `NULL` が入り、一意インデックスにも違反しない。DB を戻す必要はない。

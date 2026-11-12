## Context

申請の状態は `src/db.js` の `expense_claims.status` 列に保存しており、この列には `CHECK (status IN ('pending','approved','rejected'))` が付いている。状態を変える操作（承認・差戻し）は repository の条件付き UPDATE 1 文（`WHERE id = ? AND status = 'pending'`）で行い、出し直しは `BEGIN IMMEDIATE` のトランザクションで判定と INSERT を行っている（ADR-0005）。

今回、新しい終端状態 `withdrawn` を API に足す。SQLite では既存の列の CHECK を変えるにはテーブルを作り直す必要があるが、in-force の ADR-0006 は「スキーマは足す方向にだけ変え、テーブルの作り直しは避ける」と決めている。ADR-0007 は「終端状態の申請は書き換えず、申請を変える操作は新しい記録を作るか新しい状態を足す方向で考える」としている。

確認した in-force の ADR は ADR-0001〜0007 のすべてで、置き換えられたものはない。

## Goals / Non-Goals

**Goals:**
- 申請者が自分の `pending` の申請を `POST /expense-claims/:id/withdraw` で取り下げられる。
- API では `withdrawn` を独立した状態として扱う（応答の `status`、一覧の絞り込み、集計の `byStatus`）。
- 取り下げと承認・差戻しが同時に来ても、どちらか一方だけが成立する。
- テーブルを作り直さず、ADR-0006 の範囲で DB を変える。

**Non-Goals:**
- 取り下げの理由の記録、取り下げの取り消し、取り下げた申請の出し直し（proposal の「対象外」を参照）。
- DB の `status` 列の CHECK を変えること、`user_version` によるバージョン管理の導入。

## Decisions

### 1. 取り下げは `withdrawn_at` 列で表し、API の `status` は導き出す

`withdrawn_at TEXT`（NULL 可）を `addMissingColumns` で足し、`CREATE TABLE IF NOT EXISTS` にも書く。取り下げた申請は DB の `status` を `pending` のまま残し、`withdrawn_at` に取り下げた日時（ISO 8601、UTC）を入れる。API で返す状態（以下「実効の状態」）は次の式で決める。

```
CASE WHEN withdrawn_at IS NOT NULL THEN 'withdrawn' ELSE status END
```

- 代替案 A（テーブルを作り直して CHECK に `withdrawn` を加える）：DB と API の状態が一致するが、ADR-0006 を置き換える必要があり、古いコードへのロールバックもできなくなる。利用者と相談のうえ採らない。
- 代替案 B（取り下げを別テーブルに記録する）：一覧・集計のたびに JOIN が要り、「取り下げは 1 回だけ」の保証にも一意インデックスが要る。列 1 つで足りるため採らない。
- 代替案 C（行を削除する）：取り下げ後の承認・差戻しが 404 になり、要求（409）と合わない。記録も残らない。

`withdrawn_at` は「取り下げ日時」と「取り下げたかどうか」を兼ねる。応答の `withdrawnAt` として返し、取り下げていない申請では `null`（ADR-0001）。

### 2. 実効の状態の式を repository の 1 か所にまとめる

`repository.js` に実効の状態を表す SQL の式を定数で 1 つだけ置き、一覧の絞り込み（`WHERE (:status IS NULL OR <式> = :status)`）と集計（`GROUP BY <式>`）の両方で使う。`toClaim` は行から同じ規則（`withdrawn_at` があれば `withdrawn`、なければ `status`）で `status` を作る。SQL と JS の 2 か所に同じ規則があるため、repository のテストで「一覧・集計・応答の状態が一致する」ことを確かめる。

- `status=pending` の絞り込みは自動的に取り下げた申請を除く（式が `withdrawn` になるため）。
- 集計の初期値に `withdrawn: { count: 0, totalAmount: 0 }` を足す。`routes.js` の `CLAIM_STATUSES` にも `withdrawn` を足し、両者が同じ集合であることをコメントで示す（今のコメントの約束を保つ）。

### 3. 取り下げは条件付き UPDATE 1 文で行う（ADR-0005）

```
UPDATE expense_claims SET withdrawn_at = ?
WHERE id = ? AND applicant_id = ? AND status = 'pending' AND withdrawn_at IS NULL
```

`changes` が 0 なら `findById` で結果を決める。行がない、または `applicantId` が違えば `not_found`、それ以外は `conflict`（`claim` 付き）。他人の申請は状態に関わらず `not_found` になる（ADR-0003）。`decided_by`・`decided_at`・`reject_reason` には触れない（取り下げは判断ではないため）。

- 代替案：`BEGIN IMMEDIATE` で SELECT してから UPDATE。行を更新するだけの操作なので、ADR-0005 のとおり条件付き UPDATE 1 文にする。

### 4. 承認・差戻し・出し直しの条件に取り下げを加える

- `decideStmt` の条件を `WHERE id = ? AND status = 'pending' AND withdrawn_at IS NULL` にする。取り下げと承認が同時に来ても、どちらかの UPDATE の `changes` が 0 になり、409 になる。
- 出し直し（`checkAndResubmit`）は、取り下げた申請の DB の `status` が `pending` なので、今の `source.status !== 'rejected'` の判定で 409 になる。応答のメッセージは `toClaim(source).status`（`withdrawn`）を使うため、`申請はすでに withdrawn のため変更できません` になる。コードの変更は不要だが、テストで確かめる。

### 5. ルートは既存の判断系ルートにそろえる

`POST /expense-claims/:id/withdraw` を同じプラグインに登録し、`preValidation: requireRole('applicant')` を付ける。本文のスキーマは付けない（未知の本文は無視する、ADR-0004）。ハンドラは `parseId` が `null` なら 404、repository の `not_found` を 404、`conflict` を 409（メッセージは `申請はすでに ${status} のため変更できません`）、成功を 200 に変換する。確認の順番は 401 → 403 → 404 → 409 で、入力の検証（400）はない。

## Risks / Trade-offs

- [DB の `status` と API の `status` がずれる。DB を直接見ると取り下げた申請も `pending` に見える] → 実効の状態の式を repository の 1 か所に置き、規則を ADR に残す。今後 `status` を条件にする SQL を書くときは、この式を使う。
- [古いコードにロールバックすると、取り下げた申請が `pending` に戻って見え、承認・差戻しできてしまう] → 列の追加自体は ADR-0006 どおりロールバックしても壊れないが、意味は失われる。ロールバックした場合は `withdrawn_at IS NOT NULL` の行を一覧にして承認者に知らせる。取り下げが使われる前にロールバックの判断をする。
- [`status` を 3 値と決め打ちしているクライアントが `withdrawn` を扱えない／集計の `byStatus` のキーが 4 つになる] → proposal の Impact に明記する。値・キーの追加だけで、既存の値の意味は変えない。
- [実効の状態の規則が SQL と `toClaim` の 2 か所にある] → repository のテストで、取り下げた申請が一覧・絞り込み・集計・`findById` で同じ状態になることを確かめる。
- [`Content-Type: application/json` で本文が空の取り下げは、403 より先に 400 になる] → ADR-0003 に書かれた既知の例外で、既存の本文付き API と同じ挙動として扱う。

## Migration Plan

1. デプロイ後の最初の起動で `addMissingColumns` が `withdrawn_at` 列を足す。既存の申請はすべて `NULL`（取り下げていない）になり、状態は今までどおり。
2. DB ファイルの作り直しや手作業の移行は不要。
3. ロールバックはコードを戻すだけで動くが、取り下げた申請は `pending` に見えるようになる（Risks を参照）。

## Open Questions

- なし。ADR-0006 は置き換えない。ただし、DB の状態と API の状態を列の組み合わせで表す方法がこれ以上増えるなら、ADR-0006 の Consequences にあるとおり、`user_version` によるバージョン管理を入れてテーブルを作り直すかどうかを改めて検討する。

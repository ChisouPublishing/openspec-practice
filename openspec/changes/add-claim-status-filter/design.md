# Design

## Context

- `GET /expense-claims` のハンドラ（`src/expense-claims/routes.js`）は、ロールに応じて `repository.list({ applicantId })` か `repository.list({})` を呼ぶだけで、クエリは読んでいない。
- `repository.list`（`src/expense-claims/repository.js`）は、全件用と申請者用の 2 つの prepare 済み文を持ち、どちらも `ORDER BY created_at DESC, id DESC` で並べる。
- `src/app.js` は Ajv を `coerceTypes: false` で設定している。このため `?status=a&status=b` のように同じキーを繰り返すと、クエリの値は配列になる。
- スキーマ検証で 400 になった場合、Fastify の既定の応答の `message` は英語になる。プロジェクトの約束では `message` は日本語とする。

## Goals / Non-Goals

**Goals:**
- 状態による絞り込みを SQL の条件で行い、該当する行だけを読み出す。
- `status` の値が不正なときの 400 を、日本語の `message` で返す。

**Non-Goals:**
- スキーマ検証で起きる 400 の `message` を全体で日本語にすること（既存の作成・集計 API の挙動はこの変更では触らない）。
- 一覧のための索引の追加。

## Decisions

### `status` はハンドラで検証する（スキーマの `enum` は使わない）

`status` が「文字列で、かつ `pending`・`approved`・`rejected` のいずれか」であることをハンドラの先頭で確かめ、満たさなければ `sendError(reply, 400, 'Bad Request', 'status は pending・approved・rejected のいずれか 1 つでなければなりません')` を返す。`status` が `undefined` のときだけ「指定なし」とみなす。

- 型を文字列に限ることで、繰り返し指定（配列になる）を 400 にできる。`status=pending,rejected` と `status=`（空文字）は 3 つの値のどれとも一致しないため 400 になる。
- 識別の `onRequest` フックはハンドラより先に動くので、401 → 400 の順番は自然に守られる。この一覧には権限による 403 がない。
- 代替案：`schema.querystring` に `enum` を書く。集計 API と書き方がそろうが、`message` が英語になり、プロジェクトの約束に反する。ハンドラ内の検証は数行で済み、作成 API の `validateClaimContent` と同じく「スキーマで表せない（または表したくない）検証はハンドラで行う」という既存の分担にも沿う。

状態の集合は、`summarizeByMonth` の初期化と同じ 3 つの値を `routes.js` の定数（例：`CLAIM_STATUSES`）として持つ。

### リポジトリは 1 つの文で任意の条件を扱う

`list({ applicantId, status } = {})` とし、2 つの既存の文を次の 1 つにまとめる。

```sql
SELECT * FROM expense_claims
WHERE (:applicantId IS NULL OR applicant_id = :applicantId)
  AND (:status IS NULL OR status = :status)
ORDER BY created_at DESC, id DESC
```

`applicantId`・`status` が `undefined` のときは `null` を渡す。

- 条件の組み合わせ（申請者の有無 × 状態の有無）が 4 通りになり、文を組み合わせごとに用意すると数が増える。`IS NULL OR` で 1 つにまとめれば、並び順の指定も 1 か所で済む。
- 代替案：全件を読み出して JavaScript で `filter` する。実装は短いが、絞り込みをデータベースに任せず、「SQL の条件で行う」という目標に反する。
- 代替案：条件に応じて SQL 文字列を組み立てる。今回の 2 条件では、文字列の組み立てとプレースホルダの対応付けのほうが読みにくくなる。

### ルートはロールと状態をそのまま渡す

ハンドラは `repository.list({ applicantId: role === 'applicant' ? id : undefined, status })` を返す。申請者が見られる範囲（自分の申請だけ）は従来どおりロールで決まり、`status` はその範囲の中を絞るだけになる。

## Risks / Trade-offs

- [`IS NULL OR` 形式の条件では、将来 `status` や `applicant_id` に索引を張っても使われにくい] → 現在は索引がなく件数も少ないので影響はない。件数が増えて問題になったら、そのときに組み合わせごとの文に分ける。
- [作成・集計 API のスキーマ検証の 400 は英語の `message` のまま、一覧の 400 だけが日本語になり、エラー文の言語がそろわない] → 一覧はプロジェクトの約束に合わせる。既存 API のエラー文を日本語にそろえるのは別の変更で扱う。
- [`status` 以外の未知のクエリ（例：`?foo=1`）は無視される] → 従来の一覧も未知のクエリを無視しており、挙動は変わらない。

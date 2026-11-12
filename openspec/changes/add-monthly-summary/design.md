# Design

## Context

動機は proposal.md の「Why」、要件は `specs/expense-claims/spec.md` を参照。

現状の実装の前提:

- ルートは `src/expense-claims/routes.js` の 1 つの Fastify プラグインにまとまっており、`onRequest` フックで `X-User-Id`／`X-User-Role` を識別する（401）。ロールの確認は `preValidation` の `requireRole`（403）、入力はスキーマ検証（400）で行い、チェック順 401 → 403 → 400 を守っている。
- Ajv は `coerceTypes: false` で動いている。
- データは SQLite（`node:sqlite`）の `expense_claims` テーブルにあり、`date` は検証済みの `YYYY-MM-DD` 文字列、`amount` は整数（円）で保存されている。
- `GET /expense-claims/:id` のような GET の動的ルートはないため、`/expense-claims/summary` は既存ルートと衝突しない。

## Goals / Non-Goals

**Goals:**

- 既存のチェック順（401 → 403 → 400）を集計 API でも保つ。
- 集計を DB 側で行い、件数が増えても全件をアプリに読み込まない。

**Non-Goals:**

- 複数月の一覧や期間指定、申請者ごとの内訳。
- 集計結果のキャッシュや、`date` 列へのインデックス追加（現状の規模では不要）。
- 申請者向けの自分の集計。

## Decisions

### 1. ルートは既存プラグインに `GET /expense-claims/summary` として追加する

`onRequest` の識別フックがそのまま適用され、要件「利用者の識別」を追加実装なしで満たせる。別プラグインや `/summaries/monthly` のような別階層にすると識別フックを共有するための作り替えが必要になるため採らない。

### 2. `month` の検証は querystring スキーマで行い、ロール確認は `preValidation` に置く

`schema.querystring` に `required: ['month']`、`month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }` を指定する。Fastify は `preValidation` フックをスキーマ検証より先に実行するため、`requireRole('approver')` を `preValidation` に置けば、申請者が不正な `month` で呼んでも 403 が先に返る（仕様「申請者が不正な月で呼ぶ」）。月は年と月だけなので、日付のような実在チェック（`isRealDate`）は不要で、正規表現で `01`〜`12` に限定すれば足りる。`month=a&month=b` のように配列になった場合も `coerceTypes: false` により型エラーで 400 になる。

### 3. 集計は SQL の `GROUP BY status` で行い、ゼロ埋めはアプリ側で行う

リポジトリに `summarizeByMonth(month)` を追加し、次の形のクエリを使う:

```sql
SELECT status, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total_amount
FROM expense_claims
WHERE substr(date, 1, 7) = ?
GROUP BY status
```

結果は存在する状態の行しか返さないため、`pending`・`approved`・`rejected` をすべて `{ count: 0, totalAmount: 0 }` で初期化してから行を当てはめ、全体の `count`／`totalAmount` は 3 状態の和として計算する。

- 代替案: `list()` で全件取得して JS で集計する → 実装は簡単だが全件をメモリに載せるため採らない。
- 代替案: `WHERE date >= ? AND date < ?`（月初〜翌月初）→ インデックスを使える形だが、翌月の計算が必要になり、現状インデックスもないため、簡潔な `substr` を採る。将来インデックスを張る際に置き換えられる。
- 月を `date` で判定するのは仕様の決定どおり（`createdAt` は使わない）。`date` は `YYYY-MM-DD` で保存されていることが作成時の検証で保証されている。

### 4. 応答の形

```json
{
  "month": "2026-11",
  "count": 3,
  "totalAmount": 6000,
  "byStatus": {
    "pending":  { "count": 1, "totalAmount": 3000 },
    "approved": { "count": 1, "totalAmount": 1000 },
    "rejected": { "count": 1, "totalAmount": 2000 }
  }
}
```

キー名は既存の応答（キャメルケース）に合わせる。`month` はリクエストの値をそのまま返す。

## Risks / Trade-offs

- [金額合計の桁あふれ] 1 件の上限は 1,000,000 円で、SQLite の INTEGER は 64 ビットのため、現実的な件数では JS の `Number.MAX_SAFE_INTEGER` も超えない → 対策不要。
- [`substr` による全件走査] 申請数が大きくなると遅くなる → 必要になった時点で `date` にインデックスを張り、範囲条件に置き換える（API の挙動は変わらない）。
- [`month` の値がそのまま SQL に渡る] プレースホルダで渡し、さらにスキーマで形式を限定しているため注入の余地はない。

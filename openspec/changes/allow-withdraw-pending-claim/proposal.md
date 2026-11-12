## Why

今の仕様では、申請者は一度出した申請を自分で止める手段を持たない。金額の誤りや二重申請に気付いても、承認者に差戻してもらうしかなく、承認者の手間が増えるうえ、本来「差戻し」ではないものが差戻しの実績（`byStatus.rejected`）に混ざる。まだ判断されていない（`pending`）申請に限り、申請者が自分で取り下げられるようにし、取り下げた申請は承認も差戻しもできないようにする。

## What Changes

- 申請者が自分の `pending` の申請を取り下げる API `POST /expense-claims/:id/withdraw` を追加する。本文は受け取らない。成功すると申請の状態は `withdrawn` になり、ステータス 200 と更新後の申請を返す。
- 新しい状態 `withdrawn` を追加する。`withdrawn` は `approved`・`rejected` と同じく終端状態で、承認・差戻し・出し直し・再度の取り下げはどれも 409 になる。
- 取り下げられるのは自分の `pending` の申請だけ。承認者は 403、存在しない申請・他人の申請は 404（他人の申請は状態に関わらず 404）、`pending` でない申請は 409 とする。
- 申請を返すすべての API の応答に `withdrawnAt`（取り下げた日時。取り下げていない申請では `null`）を加える。取り下げた申請の `decidedBy`・`decidedAt`・`rejectReason` は `null` のまま。
- 一覧の絞り込み `status` に `withdrawn` を指定できるようにする。`status=pending` には取り下げた申請は含まれない。
- 月ごとの集計の `byStatus` に `withdrawn` キーを加え、4 つのキー（`pending`・`approved`・`rejected`・`withdrawn`）を常に返す。取り下げた申請は `pending` に数えない。

## 対象外

- 取り下げの理由（メモ）の記録
- 取り下げの取り消し（`withdrawn` から `pending` に戻すこと）
- 取り下げた申請の出し直し（もう一度出す場合は新しく申請する）
- `approved`・`rejected` の申請の取り下げ
- 承認者による取り下げ、承認者への通知
- 申請の削除（取り下げた申請も一覧と集計に残る）

## Capabilities

### New Capabilities

（なし）

### Modified Capabilities

- `expense-claims`: 要件「申請の取り下げ」「取り下げの権限」「取り下げできる申請」を新設する。「状態遷移の制約」に終端状態 `withdrawn` を加える。「申請の一覧」で各申請が含む項目に `withdrawnAt` を加える。「出し直しできる申請」で `withdrawn` の申請を 409 の対象に加える。「月ごとの集計」の `byStatus` に `withdrawn` を加える。「一覧の状態による絞り込み」「絞り込む状態の検証」で `withdrawn` を受け付ける。

## Impact

- API: `POST /expense-claims/:id/withdraw` を追加。申請を返す全 API（作成・一覧・承認・差戻し・出し直し・取り下げ）の応答に `withdrawnAt` が増える。`status` に新しい値 `withdrawn` が現れる。集計の `byStatus` に `withdrawn` キーが増える。いずれも追加だが、`status` を 3 値と決め打ちしているクライアントは `withdrawn` を扱えるようにする必要がある。
- コード: `src/expense-claims/routes.js`（取り下げルート、`status` の許容値）、`src/expense-claims/repository.js`（取り下げ、承認・差戻しの条件、一覧の絞り込み、集計、`toClaim`）、`src/db.js`（`withdrawn_at` 列の追加）。
- データ: 既存の DB ファイルに `withdrawn_at` 列を足す。既存の申請の `withdrawnAt` は `null` になる。
- テスト: `test/expense-claims.api.test.js`、`test/expense-claims.repository.test.js`、`test/db.test.js`、`test/expense-claims.persistence.test.js` の更新・追加。
- 依存関係の追加はなし。

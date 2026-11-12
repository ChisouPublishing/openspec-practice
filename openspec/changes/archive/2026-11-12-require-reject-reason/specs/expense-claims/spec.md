# Spec Delta

## MODIFIED Requirements

### Requirement: 申請内容の検証
システムは申請の作成時に入力を検証し、不正な場合は申請を作成せずにステータス 400 を返さなければならない（SHALL）。`date` は実在する日付の `YYYY-MM-DD` 形式、`amount` は 1 以上 1,000,000 以下の整数（円）、`description` は前後の空白を除いて 1〜200 文字の文字列でなければならない（MUST）。

#### Scenario: 金額が 0 以下
- **WHEN** `amount` が `0` の申請を送る
- **THEN** ステータス 400 が返り、申請は作成されない

#### Scenario: 金額が上限を超える
- **WHEN** `amount` が `1000001` の申請を送る
- **THEN** ステータス 400 が返り、申請は作成されない

#### Scenario: 金額が上限ちょうど
- **WHEN** `amount` が `1000000` の申請を送る
- **THEN** ステータス 201 が返り、申請が作成される

#### Scenario: 金額が整数でない
- **WHEN** `amount` が `100.5` または文字列 `"100"` の申請を送る
- **THEN** ステータス 400 が返る

#### Scenario: 存在しない日付
- **WHEN** `date` が `2026-02-30` の申請を送る
- **THEN** ステータス 400 が返る

#### Scenario: 内容が空
- **WHEN** `description` が空文字または空白のみの申請を送る
- **THEN** ステータス 400 が返る

#### Scenario: 必須項目がない
- **WHEN** `date`・`amount`・`description` のいずれかが欠けた申請を送る
- **THEN** ステータス 400 が返る

### Requirement: 申請の一覧
システムは `GET /expense-claims` に対し、ステータス 200 と申請の配列を作成日時の新しい順で返さなければならない（SHALL）。ロールが `applicant` の場合は自分（`X-User-Id`）の申請のみ、`approver` の場合はすべての申請を返さなければならない（SHALL）。各申請は `id`・`applicantId`・`date`・`amount`・`description`・`status`・`createdAt`・`decidedBy`・`decidedAt`・`rejectReason` を含まなければならない（MUST）。未判断の申請の `decidedBy`・`decidedAt` は `null` とする。差戻されていない申請の `rejectReason` は `null` とする。

#### Scenario: 申請者は自分の申請だけを見る
- **WHEN** 申請者 `u1` と `u2` がそれぞれ申請した後、`u1` が一覧を取得する
- **THEN** `u1` の申請のみが返る

#### Scenario: 承認者はすべての申請を見る
- **WHEN** 申請者 `u1` と `u2` がそれぞれ申請した後、承認者が一覧を取得する
- **THEN** 両方の申請が新しい順で返る

#### Scenario: 申請がない
- **WHEN** 申請が 1 件もない状態で一覧を取得する
- **THEN** ステータス 200 と空配列が返る

#### Scenario: 差戻し理由が一覧に含まれる
- **WHEN** 承認者が理由 `領収書がありません` を付けて申請を差戻した後、その申請の申請者が一覧を取得する
- **THEN** その申請の `rejectReason` が `領収書がありません` である

#### Scenario: 差戻されていない申請の理由は null
- **WHEN** 未判断の申請と承認済みの申請がある状態で一覧を取得する
- **THEN** どちらの申請も `rejectReason` が `null` である

### Requirement: 申請の差戻し
システムは、ロールが `approver` の利用者が `POST /expense-claims/:id/reject` に JSON 本文 `reason` を付けて呼んだとき、状態 `pending` の申請を `rejected` に変更し、`decidedBy` に承認者の ID、`decidedAt` に判断日時、`rejectReason` に前後の空白を除いた理由を記録して、ステータス 200 と更新後の申請を返さなければならない（SHALL）。

#### Scenario: 差戻しに成功する
- **WHEN** 承認者 `a1` が `{"reason":"領収書がありません"}` を付けて `pending` の申請を差戻す
- **THEN** ステータス 200 が返り、`status` が `rejected`、`decidedBy` が `a1`、`decidedAt` が設定され、`rejectReason` が `領収書がありません` である

#### Scenario: 理由は前後の空白を除いて記録される
- **WHEN** 承認者が `{"reason":"  金額が誤っています  "}` を付けて差戻す
- **THEN** `rejectReason` が `金額が誤っています` である

#### Scenario: 申請者は差戻しできない
- **WHEN** ロールが `applicant` の利用者が差戻し API を呼ぶ
- **THEN** ステータス 403 が返り、申請の状態は変わらない

### Requirement: 状態遷移の制約
システムは `pending` の申請だけを承認・差戻しできるようにしなければならない（SHALL）。`approved` と `rejected` は終端状態であり、これらの申請に承認・差戻しを行おうとした場合は状態を変えずにステータス 409 を返さなければならない（SHALL）。

#### Scenario: 承認済みの申請を差戻そうとする
- **WHEN** 承認者が `approved` の申請に有効な理由を付けて差戻し API を呼ぶ
- **THEN** ステータス 409 が返り、`status` は `approved` のまま、`rejectReason` は `null` のまま

#### Scenario: 差戻し済みの申請を承認しようとする
- **WHEN** 承認者が `rejected` の申請に承認 API を呼ぶ
- **THEN** ステータス 409 が返り、`status` は `rejected` のまま

#### Scenario: 差戻し済みの申請をもう一度差戻そうとする
- **WHEN** 承認者が `rejected` の申請に別の有効な理由を付けて差戻し API を呼ぶ
- **THEN** ステータス 409 が返り、`rejectReason` は最初の理由のまま

## ADDED Requirements

### Requirement: 差戻し理由の検証
システムは差戻し API の呼び出し時に本文の `reason` を検証し、不正な場合は申請の状態を変えずにステータス 400 を返さなければならない（SHALL）。`reason` は前後の空白を除いて 1〜500 文字の文字列でなければならない（MUST）。

#### Scenario: 理由がない
- **WHEN** 承認者が本文なし、または `reason` を含まない本文で `pending` の申請を差戻す
- **THEN** ステータス 400 が返り、`status` は `pending` のまま

#### Scenario: 理由が空
- **WHEN** 承認者が `reason` が空文字または空白のみの本文で差戻す
- **THEN** ステータス 400 が返り、`status` は `pending` のまま

#### Scenario: 理由が文字列でない
- **WHEN** 承認者が `reason` が数値 `123` の本文で差戻す
- **THEN** ステータス 400 が返る

#### Scenario: 理由が 500 文字を超える
- **WHEN** 承認者が前後の空白を除いて 501 文字の `reason` で差戻す
- **THEN** ステータス 400 が返り、`status` は `pending` のまま

#### Scenario: 理由が 500 文字ちょうど
- **WHEN** 承認者が前後の空白を除いて 500 文字の `reason` で差戻す
- **THEN** ステータス 200 が返り、`rejectReason` にその 500 文字が記録される

### Requirement: 差戻しの検証の順序
システムは差戻し API で、`reason` の検証を申請の存在の確認より先に行わなければならない（SHALL）。

#### Scenario: 存在しない申請に不正な理由で差戻す
- **WHEN** 承認者が存在しない ID に `reason` が空の本文で差戻し API を呼ぶ
- **THEN** ステータス 400 が返る（404 ではない）

# expense-claims Specification

## Purpose
申請者が経費（日付・金額・内容）を申請し、承認者がそれを承認または差戻しする経費精算の流れを、HTTP API として提供する。

## Requirements

### Requirement: 利用者の識別
システムは、経費申請に関するすべての API で、リクエストヘッダー `X-User-Id`（空でない文字列）と `X-User-Role`（`applicant` または `approver`）によって利用者を識別しなければならない（SHALL）。どちらかが欠けている、または値が不正な場合、システムは処理を行わずにステータス 401 を返さなければならない（SHALL）。ヘッダーの真正性の検証は行わない。

#### Scenario: ヘッダーがない
- **WHEN** `X-User-Id` を付けずに `GET /expense-claims` を呼ぶ
- **THEN** ステータス 401 が返る

#### Scenario: ロールが不正
- **WHEN** `X-User-Role: admin` を付けて `GET /expense-claims` を呼ぶ
- **THEN** ステータス 401 が返る

### Requirement: 経費の申請
システムは、ロールが `applicant` の利用者が `POST /expense-claims` に `date`・`amount`・`description` を JSON で送ったとき、状態 `pending` の申請を作成し、ステータス 201 と作成した申請を返さなければならない（SHALL）。申請者 ID には `X-User-Id` の値を記録しなければならない（SHALL）。

#### Scenario: 申請に成功する
- **WHEN** 申請者 `u1` が `{"date":"2026-11-01","amount":1200,"description":"タクシー代"}` を送る
- **THEN** ステータス 201 が返り、本文は `id` を持ち、`applicantId` が `u1`、`status` が `pending`、送った `date`・`amount`・`description` を含む

#### Scenario: 承認者は申請できない
- **WHEN** ロールが `approver` の利用者が `POST /expense-claims` を呼ぶ
- **THEN** ステータス 403 が返り、申請は作成されない

### Requirement: 申請内容の検証
システムは申請の作成時に入力を検証し、不正な場合は申請を作成せずにステータス 400 を返さなければならない（SHALL）。`date` は実在する日付の `YYYY-MM-DD` 形式、`amount` は 1 以上の整数（円）、`description` は前後の空白を除いて 1〜200 文字の文字列でなければならない（MUST）。

#### Scenario: 金額が 0 以下
- **WHEN** `amount` が `0` の申請を送る
- **THEN** ステータス 400 が返り、申請は作成されない

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
システムは `GET /expense-claims` に対し、ステータス 200 と申請の配列を作成日時の新しい順で返さなければならない（SHALL）。ロールが `applicant` の場合は自分（`X-User-Id`）の申請のみ、`approver` の場合はすべての申請を返さなければならない（SHALL）。各申請は `id`・`applicantId`・`date`・`amount`・`description`・`status`・`createdAt`・`decidedBy`・`decidedAt` を含まなければならない（MUST）。未判断の申請の `decidedBy`・`decidedAt` は `null` とする。

#### Scenario: 申請者は自分の申請だけを見る
- **WHEN** 申請者 `u1` と `u2` がそれぞれ申請した後、`u1` が一覧を取得する
- **THEN** `u1` の申請のみが返る

#### Scenario: 承認者はすべての申請を見る
- **WHEN** 申請者 `u1` と `u2` がそれぞれ申請した後、承認者が一覧を取得する
- **THEN** 両方の申請が新しい順で返る

#### Scenario: 申請がない
- **WHEN** 申請が 1 件もない状態で一覧を取得する
- **THEN** ステータス 200 と空配列が返る

### Requirement: 申請の承認
システムは、ロールが `approver` の利用者が `POST /expense-claims/:id/approve` を呼んだとき、状態 `pending` の申請を `approved` に変更し、`decidedBy` に承認者の ID、`decidedAt` に判断日時を記録して、ステータス 200 と更新後の申請を返さなければならない（SHALL）。

#### Scenario: 承認に成功する
- **WHEN** 承認者 `a1` が `pending` の申請を承認する
- **THEN** ステータス 200 が返り、`status` が `approved`、`decidedBy` が `a1`、`decidedAt` が設定されている

#### Scenario: 申請者は承認できない
- **WHEN** ロールが `applicant` の利用者が承認 API を呼ぶ
- **THEN** ステータス 403 が返り、申請の状態は変わらない

### Requirement: 申請の差戻し
システムは、ロールが `approver` の利用者が `POST /expense-claims/:id/reject` を呼んだとき、状態 `pending` の申請を `rejected` に変更し、`decidedBy` に承認者の ID、`decidedAt` に判断日時を記録して、ステータス 200 と更新後の申請を返さなければならない（SHALL）。

#### Scenario: 差戻しに成功する
- **WHEN** 承認者 `a1` が `pending` の申請を差戻す
- **THEN** ステータス 200 が返り、`status` が `rejected`、`decidedBy` が `a1`、`decidedAt` が設定されている

#### Scenario: 申請者は差戻しできない
- **WHEN** ロールが `applicant` の利用者が差戻し API を呼ぶ
- **THEN** ステータス 403 が返り、申請の状態は変わらない

### Requirement: 状態遷移の制約
システムは `pending` の申請だけを承認・差戻しできるようにしなければならない（SHALL）。`approved` と `rejected` は終端状態であり、これらの申請に承認・差戻しを行おうとした場合は状態を変えずにステータス 409 を返さなければならない（SHALL）。

#### Scenario: 承認済みの申請を差戻そうとする
- **WHEN** 承認者が `approved` の申請に差戻し API を呼ぶ
- **THEN** ステータス 409 が返り、`status` は `approved` のまま

#### Scenario: 差戻し済みの申請を承認しようとする
- **WHEN** 承認者が `rejected` の申請に承認 API を呼ぶ
- **THEN** ステータス 409 が返り、`status` は `rejected` のまま

### Requirement: 存在しない申請
システムは、承認・差戻し API で指定された `id` の申請が存在しない場合、ステータス 404 を返さなければならない（SHALL）。

#### Scenario: 存在しない ID を承認する
- **WHEN** 承認者が存在しない `id` に承認 API を呼ぶ
- **THEN** ステータス 404 が返る

### Requirement: データの永続化
システムは申請データを永続化し、サーバーを再起動しても作成済みの申請とその状態を保持しなければならない（SHALL）。

#### Scenario: 再起動後も申請が残る
- **WHEN** 申請を作成して承認した後、同じデータベースでサーバーを起動し直して承認者が一覧を取得する
- **THEN** その申請が `approved` の状態で返る

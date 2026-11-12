# Spec Delta

## ADDED Requirements

### Requirement: 差戻された申請の出し直し
システムは、ロールが `applicant` の利用者が自分の申請で状態が `rejected` のものに対し、`POST /expense-claims/:id/resubmit` に `date`・`amount`・`description` を JSON で送ったとき、状態 `pending` の新しい申請を作成し、ステータス 201 と作成した申請を返さなければならない（SHALL）。新しい申請の申請者 ID には `X-User-Id` の値を、`resubmittedFrom` には元の申請の `id` を記録しなければならない（SHALL）。元の申請の状態・`decidedBy`・`decidedAt`・`rejectReason` は変更してはならない（MUST NOT）。

#### Scenario: 出し直しに成功する
- **WHEN** 申請者 `u1` の申請（`id` が `1`）が理由 `領収書がありません` で差戻された後、`u1` が `{"date":"2026-11-02","amount":1500,"description":"タクシー代（領収書添付）"}` を付けて `POST /expense-claims/1/resubmit` を呼ぶ
- **THEN** ステータス 201 が返り、本文は `1` とは異なる `id` を持ち、`applicantId` が `u1`、`status` が `pending`、`resubmittedFrom` が `1`、`decidedBy`・`decidedAt`・`rejectReason` が `null` で、送った `date`・`amount`・`description` を含む

#### Scenario: 元の申請は差戻しのまま残る
- **WHEN** 申請者が差戻された申請を出し直した後、一覧を取得する
- **THEN** 元の申請と新しい申請の両方が返り、元の申請は `status` が `rejected` のままで、`decidedBy`・`decidedAt`・`rejectReason` も差戻し時の値のままである

### Requirement: 出し直しの権限
システムは、ロールが `approver` の利用者が出し直し API を呼んだ場合、申請を作成せずにステータス 403 を返さなければならない（SHALL）。指定された `id` の申請が存在しない場合、または申請者が `X-User-Id` と異なる申請である場合、システムは申請を作成せずにステータス 404 を返さなければならない（SHALL）。他人の申請については、その状態に関わらず 404 を返す。

#### Scenario: 承認者は出し直せない
- **WHEN** ロールが `approver` の利用者が、差戻された申請に有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 403 が返り、申請は作成されない

#### Scenario: 他人の申請は出し直せない
- **WHEN** 申請者 `u1` の申請が差戻された後、申請者 `u2` がその申請に有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 404 が返り、申請は作成されない

#### Scenario: 他人の差戻されていない申請も 404 になる
- **WHEN** 申請者 `u2` が、申請者 `u1` の `pending` の申請に有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 404 が返る（409 ではない）

#### Scenario: 存在しない申請を出し直す
- **WHEN** 申請者が存在しない `id` に有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 404 が返る

### Requirement: 出し直しの内容の検証
システムは出し直し API の呼び出し時に本文を「申請内容の検証」と同じ規則で検証し、不正な場合は申請を作成せずにステータス 400 を返さなければならない（SHALL）。本文の検証は、元の申請の存在と申請者の確認より先に行わなければならない（SHALL）。

#### Scenario: 金額が不正
- **WHEN** 申請者が自分の差戻された申請に、`amount` が `0` の本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 400 が返り、申請は作成されない

#### Scenario: 必須項目がない
- **WHEN** 申請者が自分の差戻された申請に、`description` を含まない本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 400 が返り、申請は作成されない

#### Scenario: 存在しない申請に不正な本文で出し直す
- **WHEN** 申請者が存在しない `id` に、`date` が `2026-02-30` の本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 400 が返る（404 ではない）

### Requirement: 出し直しできる申請
システムは、状態が `rejected` で、まだ出し直されていない申請だけを出し直せるようにしなければならない（SHALL）。状態が `pending` または `approved` の申請、およびすでに出し直された申請に出し直しを行おうとした場合、システムは申請を作成せずにステータス 409 を返さなければならない（SHALL）。出し直して作られた申請が差戻された場合は、その申請を出し直せる。

#### Scenario: 未判断の申請は出し直せない
- **WHEN** 申請者が自分の `pending` の申請に有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 409 が返り、申請は作成されない

#### Scenario: 承認済みの申請は出し直せない
- **WHEN** 申請者が自分の `approved` の申請に有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 409 が返り、申請は作成されない

#### Scenario: 同じ申請を 2 回出し直せない
- **WHEN** 申請者が差戻された申請を出し直した後、同じ申請にもう一度有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 409 が返り、その申請を `resubmittedFrom` に持つ申請は 1 件だけのままである

#### Scenario: 出し直した申請が差戻されたら、さらに出し直せる
- **WHEN** 申請 `1` を出し直して申請 `2` ができ、申請 `2` が差戻された後、申請者が申請 `2` に有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 201 が返り、新しい申請の `resubmittedFrom` が `2` である

## MODIFIED Requirements

### Requirement: 申請の一覧
システムは `GET /expense-claims` に対し、ステータス 200 と申請の配列を作成日時の新しい順で返さなければならない（SHALL）。ロールが `applicant` の場合は自分（`X-User-Id`）の申請のみ、`approver` の場合はすべての申請を返さなければならない（SHALL）。各申請は `id`・`applicantId`・`date`・`amount`・`description`・`status`・`createdAt`・`decidedBy`・`decidedAt`・`rejectReason`・`resubmittedFrom` を含まなければならない（MUST）。未判断の申請の `decidedBy`・`decidedAt` は `null` とする。差戻されていない申請の `rejectReason` は `null` とする。出し直しで作られた申請でない場合、`resubmittedFrom` は `null` とする。

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

#### Scenario: 出し直しの紐付けが一覧に含まれる
- **WHEN** 申請者が申請 `1` を作成し、それが差戻された後に出し直してから一覧を取得する
- **THEN** 出し直した申請の `resubmittedFrom` が `1` であり、申請 `1` の `resubmittedFrom` は `null` である

### Requirement: 状態遷移の制約
システムは `pending` の申請だけを承認・差戻しできるようにしなければならない（SHALL）。`approved` と `rejected` は終端状態であり、これらの申請に承認・差戻しを行おうとした場合は状態を変えずにステータス 409 を返さなければならない（SHALL）。`rejected` の申請に対して受け付ける操作は出し直しだけであり、出し直しても元の申請の状態は `rejected` のまま変わらない。

#### Scenario: 承認済みの申請を差戻そうとする
- **WHEN** 承認者が `approved` の申請に有効な理由を付けて差戻し API を呼ぶ
- **THEN** ステータス 409 が返り、`status` は `approved` のまま、`rejectReason` は `null` のまま

#### Scenario: 差戻し済みの申請を承認しようとする
- **WHEN** 承認者が `rejected` の申請に承認 API を呼ぶ
- **THEN** ステータス 409 が返り、`status` は `rejected` のまま

#### Scenario: 差戻し済みの申請をもう一度差戻そうとする
- **WHEN** 承認者が `rejected` の申請に別の有効な理由を付けて差戻し API を呼ぶ
- **THEN** ステータス 409 が返り、`rejectReason` は最初の理由のまま

#### Scenario: 出し直された元の申請も承認できない
- **WHEN** 差戻された申請が出し直された後、承認者が元の申請に承認 API を呼ぶ
- **THEN** ステータス 409 が返り、元の申請の `status` は `rejected` のまま

### Requirement: 月ごとの集計
システムは、ロールが `approver` の利用者が `GET /expense-claims/summary?month=YYYY-MM` を呼んだとき、経費の日付 `date` が指定した月に含まれる、すべての申請者の申請を集計し、ステータス 200 を返さなければならない（SHALL）。応答は `month`（指定した月）と `byStatus` を含まなければならない（MUST）。全体の件数・金額合計は含めない。`byStatus` は `pending`・`approved`・`rejected` の 3 つのキーを常に持ち、それぞれが `count` と `totalAmount` を持つ。該当する申請がない状態は `count`・`totalAmount` ともに `0` とする。出し直した申請と元の申請は、それぞれ別の申請として、各自の状態と `date` で集計する。したがって `byStatus.rejected` は、出し直されたかどうかに関わらず差戻しが起きた申請の実績を表す。

#### Scenario: 状態ごとに集計される
- **WHEN** `date` が `2026-11-01` で金額 `1000` の申請が承認され、`2026-11-15` で金額 `2000` の申請が差戻され、`2026-11-30` で金額 `3000` の申請が未判断の状態で、承認者が `month=2026-11` の集計を取得する
- **THEN** ステータス 200 が返り、`month` が `2026-11`、`byStatus.approved` が `{"count":1,"totalAmount":1000}`、`byStatus.rejected` が `{"count":1,"totalAmount":2000}`、`byStatus.pending` が `{"count":1,"totalAmount":3000}` である

#### Scenario: 経費の日付で月を判定する
- **WHEN** `date` が `2026-10-31` の申請と `2026-12-01` の申請と `2026-11-10` の申請がある状態で、承認者が `month=2026-11` の集計を取得する
- **THEN** `date` が `2026-11-10` の申請だけが集計される（申請を作成した日時には関係しない）

#### Scenario: すべての申請者の申請が対象になる
- **WHEN** 申請者 `u1` と `u2` がそれぞれ同じ月の日付で申請した後、承認者がその月の集計を取得する
- **THEN** 両方の申請が `byStatus.pending` の `count` と `totalAmount` に含まれる

#### Scenario: 該当する申請がない
- **WHEN** 指定した月の日付の申請が 1 件もない状態で、承認者が集計を取得する
- **THEN** ステータス 200 が返り、`month` が指定した月で、`byStatus` の 3 つの状態すべてが `{"count":0,"totalAmount":0}` である

#### Scenario: 差戻した申請と出し直した申請は別々に数えられる
- **WHEN** `date` が `2026-11-15` で金額 `2000` の申請が差戻され、申請者がそれを `date` `2026-11-15`・金額 `1800` で出し直して未判断の状態で、承認者が `month=2026-11` の集計を取得する
- **THEN** `byStatus.rejected` が `{"count":1,"totalAmount":2000}`、`byStatus.pending` が `{"count":1,"totalAmount":1800}` である（元の申請は差戻しの実績として残る）

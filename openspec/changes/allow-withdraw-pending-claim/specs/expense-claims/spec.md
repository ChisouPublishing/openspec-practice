## ADDED Requirements

### Requirement: 申請の取り下げ
システムは、ロールが `applicant` の利用者が自分の申請で状態が `pending` のものに対し `POST /expense-claims/:id/withdraw` を呼んだとき、その申請の状態を `withdrawn` に変更し、`withdrawnAt` に取り下げた日時を記録して、ステータス 200 と更新後の申請を返さなければならない（SHALL）。本文は受け取らず、送られても無視する。取り下げた申請の `decidedBy`・`decidedAt`・`rejectReason` は `null` のままとし、`date`・`amount`・`description`・`resubmittedFrom`・`resubmitNote` は変更してはならない（MUST NOT）。取り下げた申請は削除せず、一覧と集計に残さなければならない（SHALL）。

#### Scenario: 取り下げに成功する
- **WHEN** 申請者 `u1` が自分の `pending` の申請に `POST /expense-claims/:id/withdraw` を呼ぶ
- **THEN** ステータス 200 が返り、`status` が `withdrawn`、`withdrawnAt` が設定され、`decidedBy`・`decidedAt`・`rejectReason` が `null` で、`date`・`amount`・`description` は申請時のままである

#### Scenario: 取り下げた申請は一覧に残る
- **WHEN** 申請者 `u1` が自分の申請を取り下げた後、一覧を取得する
- **THEN** ステータス 200 が返り、その申請が `status` が `withdrawn` の状態で含まれる

#### Scenario: 出し直した申請も取り下げられる
- **WHEN** 差戻された申請 `1` を出し直して申請 `2` ができた後、申請者が申請 `2` を取り下げる
- **THEN** ステータス 200 が返り、申請 `2` の `status` が `withdrawn`、`resubmittedFrom` が `1` のままで、申請 `1` の `status` は `rejected` のままである

#### Scenario: 再起動後も取り下げが残る
- **WHEN** 申請を作成して取り下げた後、同じデータベースでサーバーを起動し直して申請者が一覧を取得する
- **THEN** ステータス 200 が返り、その申請が `status` が `withdrawn` で `withdrawnAt` が設定された状態で返る

### Requirement: 取り下げの権限
システムは、ロールが `approver` の利用者が取り下げ API を呼んだ場合、申請の状態を変えずにステータス 403 を返さなければならない（SHALL）。指定された `id` の申請が存在しない場合、または申請者が `X-User-Id` と異なる申請である場合、システムは申請の状態を変えずにステータス 404 を返さなければならない（SHALL）。他人の申請については、その状態に関わらず 404 を返す。

#### Scenario: 承認者は取り下げられない
- **WHEN** ロールが `approver` の利用者が `pending` の申請に取り下げ API を呼ぶ
- **THEN** ステータス 403 が返り、申請の `status` は `pending` のまま

#### Scenario: 他人の申請は取り下げられない
- **WHEN** 申請者 `u2` が申請者 `u1` の `pending` の申請に取り下げ API を呼ぶ
- **THEN** ステータス 404 が返り、申請の `status` は `pending` のまま

#### Scenario: 他人の判断済みの申請も 404 になる
- **WHEN** 申請者 `u2` が申請者 `u1` の `approved` の申請に取り下げ API を呼ぶ
- **THEN** ステータス 404 が返る（409 ではない）

#### Scenario: 存在しない申請を取り下げる
- **WHEN** 申請者が存在しない `id` に取り下げ API を呼ぶ
- **THEN** ステータス 404 が返る

### Requirement: 取り下げできる申請
システムは、状態が `pending` の申請だけを取り下げられるようにしなければならない（SHALL）。状態が `approved`・`rejected`・`withdrawn` の申請に取り下げを行おうとした場合、システムは申請を変更せずにステータス 409 を返さなければならない（SHALL）。

#### Scenario: 承認済みの申請は取り下げられない
- **WHEN** 申請者が自分の `approved` の申請に取り下げ API を呼ぶ
- **THEN** ステータス 409 が返り、`status` は `approved` のまま、`withdrawnAt` は `null` のまま

#### Scenario: 差戻された申請は取り下げられない
- **WHEN** 申請者が自分の `rejected` の申請に取り下げ API を呼ぶ
- **THEN** ステータス 409 が返り、`status` は `rejected` のまま、`rejectReason` は差戻し時の値のまま

#### Scenario: 同じ申請を 2 回取り下げられない
- **WHEN** 申請者が自分の申請を取り下げた後、同じ申請にもう一度取り下げ API を呼ぶ
- **THEN** ステータス 409 が返り、`withdrawnAt` は 1 回目に記録した値のまま

## MODIFIED Requirements

### Requirement: 申請の一覧
システムは `GET /expense-claims` に対し、ステータス 200 と申請の配列を作成日時の新しい順で返さなければならない（SHALL）。ロールが `applicant` の場合は自分（`X-User-Id`）の申請のみ、`approver` の場合はすべての申請を返さなければならない（SHALL）。各申請は `id`・`applicantId`・`date`・`amount`・`description`・`status`・`createdAt`・`decidedBy`・`decidedAt`・`rejectReason`・`resubmittedFrom`・`resubmitNote`・`withdrawnAt` を含まなければならない（MUST）。未判断の申請と取り下げた申請の `decidedBy`・`decidedAt` は `null` とする。差戻されていない申請の `rejectReason` は `null` とする。出し直しで作られた申請でない場合、`resubmittedFrom` と `resubmitNote` は `null` とする。取り下げていない申請の `withdrawnAt` は `null` とする。

#### Scenario: 申請者は自分の申請だけを見る
- **WHEN** 申請者 `u1` と `u2` がそれぞれ申請した後、`u1` が一覧を取得する
- **THEN** ステータス 200 が返り、`u1` の申請のみが返る

#### Scenario: 承認者はすべての申請を見る
- **WHEN** 申請者 `u1` と `u2` がそれぞれ申請した後、承認者が一覧を取得する
- **THEN** ステータス 200 が返り、両方の申請が新しい順で返る

#### Scenario: 申請がない
- **WHEN** 申請が 1 件もない状態で一覧を取得する
- **THEN** ステータス 200 と空配列が返る

#### Scenario: 差戻し理由が一覧に含まれる
- **WHEN** 承認者が理由 `領収書がありません` を付けて申請を差戻した後、その申請の申請者が一覧を取得する
- **THEN** ステータス 200 が返り、その申請の `rejectReason` が `領収書がありません` である

#### Scenario: 差戻されていない申請の理由は null
- **WHEN** 未判断の申請と承認済みの申請がある状態で一覧を取得する
- **THEN** ステータス 200 が返り、どちらの申請も `rejectReason` が `null` である

#### Scenario: 出し直しの紐付けが一覧に含まれる
- **WHEN** 申請者が申請 `1` を作成し、それが差戻された後に `resubmitNote` を `領収書を添付しました` として出し直してから一覧を取得する
- **THEN** ステータス 200 が返り、出し直した申請の `resubmittedFrom` が `1`、`resubmitNote` が `領収書を添付しました` であり、申請 `1` の `resubmittedFrom` と `resubmitNote` は `null` である

#### Scenario: 取り下げていない申請の取り下げ日時は null
- **WHEN** 未判断・承認済み・差戻しの申請がある状態で一覧を取得する
- **THEN** ステータス 200 が返り、すべての申請の `withdrawnAt` が `null` である

### Requirement: 状態遷移の制約
システムは `pending` の申請だけを承認・差戻し・取り下げできるようにしなければならない（SHALL）。`approved`・`rejected`・`withdrawn` は終端状態であり、これらの申請に承認・差戻しを行おうとした場合は状態を変えずにステータス 409 を返さなければならない（SHALL）。`rejected` の申請に対して受け付ける操作は出し直しだけであり、出し直しても元の申請の状態は `rejected` のまま変わらない。`withdrawn` の申請に対して受け付ける状態の変更はない。

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

#### Scenario: 取り下げた申請は承認できない
- **WHEN** 申請者が申請を取り下げた後、承認者がその申請に承認 API を呼ぶ
- **THEN** ステータス 409 が返り、`status` は `withdrawn` のまま、`decidedBy`・`decidedAt` は `null` のまま

#### Scenario: 取り下げた申請は差戻しできない
- **WHEN** 申請者が申請を取り下げた後、承認者がその申請に有効な理由を付けて差戻し API を呼ぶ
- **THEN** ステータス 409 が返り、`status` は `withdrawn` のまま、`rejectReason` は `null` のまま

### Requirement: 月ごとの集計
システムは、ロールが `approver` の利用者が `GET /expense-claims/summary?month=YYYY-MM` を呼んだとき、経費の日付 `date` が指定した月に含まれる、すべての申請者の申請を集計し、ステータス 200 を返さなければならない（SHALL）。応答は `month`（指定した月）と `byStatus` を含まなければならない（MUST）。全体の件数・金額合計は含めない。`byStatus` は `pending`・`approved`・`rejected`・`withdrawn` の 4 つのキーを常に持ち、それぞれが `count` と `totalAmount` を持つ。該当する申請がない状態は `count`・`totalAmount` ともに `0` とする。取り下げた申請は `withdrawn` にだけ数え、`pending` には数えない。出し直した申請と元の申請は、それぞれ別の申請として、各自の状態と `date` で集計する。したがって `byStatus.rejected` は、出し直されたかどうかに関わらず差戻しが起きた申請の実績を表す。

#### Scenario: 状態ごとに集計される
- **WHEN** `date` が `2026-11-01` で金額 `1000` の申請が承認され、`2026-11-15` で金額 `2000` の申請が差戻され、`2026-11-30` で金額 `3000` の申請が未判断で、`2026-11-20` で金額 `4000` の申請が取り下げられた状態で、承認者が `month=2026-11` の集計を取得する
- **THEN** ステータス 200 が返り、`month` が `2026-11`、`byStatus.approved` が `{"count":1,"totalAmount":1000}`、`byStatus.rejected` が `{"count":1,"totalAmount":2000}`、`byStatus.pending` が `{"count":1,"totalAmount":3000}`、`byStatus.withdrawn` が `{"count":1,"totalAmount":4000}` である

#### Scenario: 経費の日付で月を判定する
- **WHEN** `date` が `2026-10-31` の申請と `2026-12-01` の申請と `2026-11-10` の申請がある状態で、承認者が `month=2026-11` の集計を取得する
- **THEN** ステータス 200 が返り、`date` が `2026-11-10` の申請だけが集計される（申請を作成した日時には関係しない）

#### Scenario: すべての申請者の申請が対象になる
- **WHEN** 申請者 `u1` と `u2` がそれぞれ同じ月の日付で申請した後、承認者がその月の集計を取得する
- **THEN** ステータス 200 が返り、両方の申請が `byStatus.pending` の `count` と `totalAmount` に含まれる

#### Scenario: 該当する申請がない
- **WHEN** 指定した月の日付の申請が 1 件もない状態で、承認者が集計を取得する
- **THEN** ステータス 200 が返り、`month` が指定した月で、`byStatus` の 4 つの状態すべてが `{"count":0,"totalAmount":0}` である

#### Scenario: 差戻した申請と出し直した申請は別々に数えられる
- **WHEN** `date` が `2026-11-15` で金額 `2000` の申請が差戻され、申請者がそれを `date` `2026-11-15`・金額 `1800` で出し直して未判断の状態で、承認者が `month=2026-11` の集計を取得する
- **THEN** ステータス 200 が返り、`byStatus.rejected` が `{"count":1,"totalAmount":2000}`、`byStatus.pending` が `{"count":1,"totalAmount":1800}` である（元の申請は差戻しの実績として残る）

#### Scenario: 取り下げた申請は未判断に数えない
- **WHEN** `date` が `2026-11-10` で金額 `1000` の申請と金額 `500` の申請があり、金額 `500` の申請だけが取り下げられた状態で、承認者が `month=2026-11` の集計を取得する
- **THEN** ステータス 200 が返り、`byStatus.pending` が `{"count":1,"totalAmount":1000}`、`byStatus.withdrawn` が `{"count":1,"totalAmount":500}` である

### Requirement: 出し直しできる申請
システムは、状態が `rejected` で、まだ出し直されていない申請だけを出し直せるようにしなければならない（SHALL）。状態が `pending`・`approved`・`withdrawn` の申請、およびすでに出し直された申請に出し直しを行おうとした場合、システムは申請を作成せずにステータス 409 を返さなければならない（SHALL）。出し直して作られた申請が差戻された場合は、その申請を出し直せる。

#### Scenario: 未判断の申請は出し直せない
- **WHEN** 申請者が自分の `pending` の申請に有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 409 が返り、申請は作成されない

#### Scenario: 承認済みの申請は出し直せない
- **WHEN** 申請者が自分の `approved` の申請に有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 409 が返り、申請は作成されない

#### Scenario: 取り下げた申請は出し直せない
- **WHEN** 申請者が自分の `withdrawn` の申請に有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 409 が返り、申請は作成されない

#### Scenario: 同じ申請を 2 回出し直せない
- **WHEN** 申請者が差戻された申請を出し直した後、同じ申請にもう一度有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 409 が返り、その申請を `resubmittedFrom` に持つ申請は 1 件だけのままである

#### Scenario: 出し直した申請を取り下げても、元の申請はもう出し直せない
- **WHEN** 差戻された申請 `1` を出し直して申請 `2` ができ、申請 `2` を取り下げた後、申請者が申請 `1` にもう一度有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 409 が返り、申請は作成されない

#### Scenario: 出し直した申請が差戻されたら、さらに出し直せる
- **WHEN** 申請 `1` を出し直して申請 `2` ができ、申請 `2` が差戻された後、申請者が申請 `2` に有効な本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 201 が返り、新しい申請の `resubmittedFrom` が `2` である

### Requirement: 一覧の状態による絞り込み
システムは `GET /expense-claims` にクエリ `status` が指定されたとき、「申請の一覧」で返す対象の申請のうち、状態がその値と一致するものだけをステータス 200 で返さなければならない（SHALL）。並び順と各申請の項目は「申請の一覧」と同じとする。`status` が指定されない場合は、状態に関わらず返さなければならない（SHALL）。出し直された元の申請は状態が `rejected` のまま扱う。取り下げた申請は状態が `withdrawn` として扱い、`status=pending` には含めない。

#### Scenario: 承認者が未判断の申請だけを見る
- **WHEN** 申請者 `u1` と `u2` の申請がそれぞれ未判断・承認済み・差戻しの状態である中で、承認者が `status=pending` で一覧を取得する
- **THEN** ステータス 200 が返り、`u1` と `u2` の未判断の申請だけが新しい順で返る

#### Scenario: 申請者は自分の申請の中から絞り込む
- **WHEN** 申請者 `u1` と `u2` がそれぞれ未判断の申請と承認済みの申請を持つ状態で、`u1` が `status=approved` で一覧を取得する
- **THEN** ステータス 200 が返り、`u1` の承認済みの申請だけが返る

#### Scenario: 差戻しで絞り込むと出し直された元の申請も含まれる
- **WHEN** 差戻された申請が出し直されて新しい申請が未判断である状態で、承認者が `status=rejected` で一覧を取得する
- **THEN** ステータス 200 が返り、元の申請が含まれ、出し直した申請は含まれない

#### Scenario: 取り下げた申請だけを見る
- **WHEN** 未判断の申請と取り下げた申請がある状態で、承認者が `status=withdrawn` で一覧を取得する
- **THEN** ステータス 200 が返り、取り下げた申請だけが返る

#### Scenario: 未判断で絞り込むと取り下げた申請は含まれない
- **WHEN** 未判断の申請と取り下げた申請がある状態で、承認者が `status=pending` で一覧を取得する
- **THEN** ステータス 200 が返り、未判断の申請だけが返る

#### Scenario: 該当する申請がない
- **WHEN** 承認済みの申請が 1 件もない状態で、承認者が `status=approved` で一覧を取得する
- **THEN** ステータス 200 と空配列が返る

#### Scenario: 指定しない場合はすべての状態を返す
- **WHEN** 未判断・承認済み・差戻し・取り下げの申請がある状態で、承認者が `status` を付けずに一覧を取得する
- **THEN** ステータス 200 が返り、4 件すべてが返る

### Requirement: 絞り込む状態の検証
システムは一覧 API の呼び出し時にクエリ `status` を検証し、不正な場合は一覧を返さずにステータス 400 を返さなければならない（SHALL）。`status` は `pending`・`approved`・`rejected`・`withdrawn` のいずれか 1 つでなければならない（MUST）。空文字・大文字小文字の違う値・複数の指定は不正とする。利用者の識別（401）は、この検証より先に行わなければならない（SHALL）。

#### Scenario: 存在しない状態
- **WHEN** 承認者が `status=draft` で一覧を取得する
- **THEN** ステータス 400 が返る

#### Scenario: 空の値
- **WHEN** 承認者が `status=` で一覧を取得する
- **THEN** ステータス 400 が返る

#### Scenario: 大文字で指定する
- **WHEN** 承認者が `status=PENDING` または `status=WITHDRAWN` で一覧を取得する
- **THEN** ステータス 400 が返る

#### Scenario: 複数の状態を指定する
- **WHEN** 承認者が `status=pending&status=rejected` または `status=pending,withdrawn` で一覧を取得する
- **THEN** ステータス 400 が返る

#### Scenario: ヘッダーがなく状態も不正
- **WHEN** `X-User-Id` を付けずに `status=draft` で一覧を取得する
- **THEN** ステータス 401 が返る（400 ではない）

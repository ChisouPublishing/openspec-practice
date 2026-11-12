## ADDED Requirements

### Requirement: 一覧の申請の項目
システムは一覧で返す各申請に、`id`・`applicantId`・`date`・`amount`・`description`・`status`・`createdAt`・`decidedBy`・`decidedAt`・`rejectReason`・`resubmittedFrom`・`resubmitNote`・`withdrawnAt` を含めなければならない（MUST）。未判断の申請と取り下げた申請の `decidedBy`・`decidedAt` は `null` とする。差戻されていない申請の `rejectReason` は `null` とする。出し直しで作られた申請でない場合、`resubmittedFrom` と `resubmitNote` は `null` とする。取り下げていない申請の `withdrawnAt` は `null` とする。

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

### Requirement: 集計での取り下げと出し直しの扱い
システムは月ごとの集計で、取り下げた申請を `byStatus.withdrawn` にだけ数え、`byStatus.pending` に数えてはならない（MUST NOT）。出し直した申請と元の申請は、それぞれ別の申請として、各自の状態と `date` で集計しなければならない（SHALL）。したがって `byStatus.rejected` は、出し直されたかどうかに関わらず差戻しが起きた申請の実績を表す。

#### Scenario: 差戻した申請と出し直した申請は別々に数えられる
- **WHEN** `date` が `2026-11-15` で金額 `2000` の申請が差戻され、申請者がそれを `date` `2026-11-15`・金額 `1800` で出し直して未判断の状態で、承認者が `month=2026-11` の集計を取得する
- **THEN** ステータス 200 が返り、`byStatus.rejected` が `{"count":1,"totalAmount":2000}`、`byStatus.pending` が `{"count":1,"totalAmount":1800}` である（元の申請は差戻しの実績として残る）

#### Scenario: 取り下げた申請は未判断に数えない
- **WHEN** `date` が `2026-11-10` で金額 `1000` の申請と金額 `500` の申請があり、金額 `500` の申請だけが取り下げられた状態で、承認者が `month=2026-11` の集計を取得する
- **THEN** ステータス 200 が返り、`byStatus.pending` が `{"count":1,"totalAmount":1000}`、`byStatus.withdrawn` が `{"count":1,"totalAmount":500}` である

### Requirement: 申請の一覧の対象と並び順
システムは `GET /expense-claims` に対し、ステータス 200 と申請の配列を作成日時の新しい順で返さなければならない（SHALL）。ロールが `applicant` の場合は自分（`X-User-Id`）の申請のみ、`approver` の場合はすべての申請を返さなければならない（SHALL）。各申請が含む項目は「一覧の申請の項目」に従う。

#### Scenario: 申請者は自分の申請だけを見る
- **WHEN** 申請者 `u1` と `u2` がそれぞれ申請した後、`u1` が一覧を取得する
- **THEN** ステータス 200 が返り、`u1` の申請のみが返る

#### Scenario: 承認者はすべての申請を見る
- **WHEN** 申請者 `u1` と `u2` がそれぞれ申請した後、承認者が一覧を取得する
- **THEN** ステータス 200 が返り、両方の申請が新しい順で返る

#### Scenario: 申請がない
- **WHEN** 申請が 1 件もない状態で一覧を取得する
- **THEN** ステータス 200 と空配列が返る

### Requirement: 月ごとの集計の対象と応答
システムは、ロールが `approver` の利用者が `GET /expense-claims/summary?month=YYYY-MM` を呼んだとき、経費の日付 `date` が指定した月に含まれる、すべての申請者の申請を集計し、ステータス 200 を返さなければならない（SHALL）。応答は `month`（指定した月）と `byStatus` を含まなければならない（MUST）。全体の件数・金額合計は含めない。`byStatus` は `pending`・`approved`・`rejected`・`withdrawn` の 4 つのキーを常に持ち、それぞれが `count` と `totalAmount` を持つ。該当する申請がない状態は `count`・`totalAmount` ともに `0` とする。取り下げた申請と出し直した申請の数え方は「集計での取り下げと出し直しの扱い」に従う。

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

## MODIFIED Requirements

### Requirement: 一覧の状態による絞り込み
システムは `GET /expense-claims` にクエリ `status` が指定されたとき、「申請の一覧の対象と並び順」で返す対象の申請のうち、状態がその値と一致するものだけをステータス 200 で返さなければならない（SHALL）。並び順は「申請の一覧の対象と並び順」、各申請の項目は「一覧の申請の項目」と同じとする。`status` が指定されない場合は、状態に関わらず返さなければならない（SHALL）。出し直された元の申請は状態が `rejected` のまま扱う。取り下げた申請は状態が `withdrawn` として扱い、`status=pending` には含めない。

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

## REMOVED Requirements

### Requirement: 申請の一覧
**Reason**: 本文が 500 文字を超え、`openspec validate --strict` を通らないため。振る舞いは変えずに 2 つの要件に分けて書き直す。
**Migration**: 返す対象と並び順は「申請の一覧の対象と並び順」、各申請の項目と `null` の規則は「一覧の申請の項目」に移した。シナリオは文言を変えずに移した。

### Requirement: 月ごとの集計
**Reason**: 本文が 500 文字を超え、`openspec validate --strict` を通らないため。振る舞いは変えずに 2 つの要件に分けて書き直す。
**Migration**: 集計の対象と応答の形は「月ごとの集計の対象と応答」、取り下げた申請と出し直した申請の数え方は「集計での取り下げと出し直しの扱い」に移した。シナリオは文言を変えずに移した。

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

### Requirement: 申請の承認
システムは、ロールが `approver` の利用者が `POST /expense-claims/:id/approve` を呼んだとき、状態 `pending` の申請を `approved` に変更し、`decidedBy` に承認者の ID、`decidedAt` に判断日時を記録して、ステータス 200 と更新後の申請を返さなければならない（SHALL）。

#### Scenario: 承認に成功する
- **WHEN** 承認者 `a1` が `pending` の申請を承認する
- **THEN** ステータス 200 が返り、`status` が `approved`、`decidedBy` が `a1`、`decidedAt` が設定されている

#### Scenario: 申請者は承認できない
- **WHEN** ロールが `applicant` の利用者が承認 API を呼ぶ
- **THEN** ステータス 403 が返り、申請の状態は変わらない

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

### Requirement: 集計の権限
システムは、ロールが `applicant` の利用者が `GET /expense-claims/summary` を呼んだ場合、`month` の値に関わらず集計を行わずにステータス 403 を返さなければならない（SHALL）。

#### Scenario: 申請者は集計を見られない
- **WHEN** ロールが `applicant` の利用者が `month=2026-11` で集計 API を呼ぶ
- **THEN** ステータス 403 が返る

#### Scenario: 申請者が不正な月で呼ぶ
- **WHEN** ロールが `applicant` の利用者が `month=2026-13` で集計 API を呼ぶ
- **THEN** ステータス 403 が返る（400 ではない）

### Requirement: 集計する月の検証
システムは集計 API の呼び出し時にクエリ `month` を検証し、不正な場合は集計を行わずにステータス 400 を返さなければならない（SHALL）。`month` は `YYYY-MM` 形式で、月が `01`〜`12` のいずれかでなければならない（MUST）。

#### Scenario: 月の指定がない
- **WHEN** 承認者が `month` を付けずに集計 API を呼ぶ
- **THEN** ステータス 400 が返る

#### Scenario: 存在しない月
- **WHEN** 承認者が `month=2026-13` または `month=2026-00` で集計 API を呼ぶ
- **THEN** ステータス 400 が返る

#### Scenario: 形式が違う
- **WHEN** 承認者が `month=2026-1`、`month=2026/11`、`month=2026-11-01` のいずれかで集計 API を呼ぶ
- **THEN** ステータス 400 が返る

### Requirement: 差戻された申請の出し直し
システムは、ロールが `applicant` の利用者が自分の申請で状態が `rejected` のものに対し、`POST /expense-claims/:id/resubmit` に `date`・`amount`・`description`・`resubmitNote` を JSON で送ったとき、状態 `pending` の新しい申請を作成し、ステータス 201 と作成した申請を返さなければならない（SHALL）。新しい申請の申請者 ID には `X-User-Id` の値を、`resubmittedFrom` には元の申請の `id` を、`resubmitNote` には送った `resubmitNote` の前後の空白を除いた値を記録しなければならない（SHALL）。元の申請の状態・`decidedBy`・`decidedAt`・`rejectReason` は変更してはならない（MUST NOT）。

#### Scenario: 出し直しに成功する
- **WHEN** 申請者 `u1` の申請（`id` が `1`）が理由 `領収書がありません` で差戻された後、`u1` が `{"date":"2026-11-02","amount":1500,"description":"タクシー代（領収書添付）","resubmitNote":"領収書を添付しました"}` を付けて `POST /expense-claims/1/resubmit` を呼ぶ
- **THEN** ステータス 201 が返り、本文は `1` とは異なる `id` を持ち、`applicantId` が `u1`、`status` が `pending`、`resubmittedFrom` が `1`、`resubmitNote` が `領収書を添付しました`、`decidedBy`・`decidedAt`・`rejectReason` が `null` で、送った `date`・`amount`・`description` を含む

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
システムは出し直し API の呼び出し時に、本文の `date`・`amount`・`description` を「申請内容の検証」と同じ規則で検証しなければならない（SHALL）。`resubmitNote` は必須の文字列で、前後の空白を除いて 1〜200 文字でなければならない（MUST）。いずれかが不正な場合は申請を作成せずにステータス 400 を返さなければならない（SHALL）。本文の検証は、元の申請の存在と申請者の確認より先に行わなければならない（SHALL）。

#### Scenario: 金額が不正
- **WHEN** 申請者が自分の差戻された申請に、`amount` が `0` の本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 400 が返り、申請は作成されない

#### Scenario: 必須項目がない
- **WHEN** 申請者が自分の差戻された申請に、`description` を含まない本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 400 が返り、申請は作成されない

#### Scenario: 存在しない申請に不正な本文で出し直す
- **WHEN** 申請者が存在しない `id` に、`date` が `2026-02-30` の本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 400 が返る（404 ではない）

#### Scenario: 直した内容のメモがない
- **WHEN** 申請者が自分の差戻された申請に、`resubmitNote` を含まない本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 400 が返り、申請は作成されない

#### Scenario: 直した内容のメモが空白だけ
- **WHEN** 申請者が自分の差戻された申請に、`resubmitNote` が `"   "` の本文を付けて出し直し API を呼ぶ
- **THEN** ステータス 400 が返り、申請は作成されない

#### Scenario: 直した内容のメモが 200 文字を超える
- **WHEN** 申請者が自分の差戻された申請に、前後の空白を除いて 201 文字の `resubmitNote` を付けて出し直し API を呼ぶ
- **THEN** ステータス 400 が返り、申請は作成されない

#### Scenario: 直した内容のメモが 200 文字ちょうど
- **WHEN** 申請者が自分の差戻された申請に、200 文字の `resubmitNote` を付けて出し直し API を呼ぶ
- **THEN** ステータス 201 が返り、`resubmitNote` に送った 200 文字が記録される

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

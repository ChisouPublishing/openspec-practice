# Spec Delta

## ADDED Requirements

### Requirement: 月ごとの集計
システムは、ロールが `approver` の利用者が `GET /expense-claims/summary?month=YYYY-MM` を呼んだとき、経費の日付 `date` が指定した月に含まれる、すべての申請者の申請を集計し、ステータス 200 を返さなければならない（SHALL）。応答は `month`（指定した月）、`count`（全体の件数）、`totalAmount`（全体の金額合計、円）、`byStatus` を含まなければならない（MUST）。`byStatus` は `pending`・`approved`・`rejected` の 3 つのキーを常に持ち、それぞれが `count` と `totalAmount` を持つ。該当する申請がない状態は `count`・`totalAmount` ともに `0` とする。

#### Scenario: 状態ごとに集計される
- **WHEN** `date` が `2026-11-01` で金額 `1000` の申請が承認され、`2026-11-15` で金額 `2000` の申請が差戻され、`2026-11-30` で金額 `3000` の申請が未判断の状態で、承認者が `month=2026-11` の集計を取得する
- **THEN** ステータス 200 が返り、`month` が `2026-11`、`count` が `3`、`totalAmount` が `6000`、`byStatus.approved` が `{"count":1,"totalAmount":1000}`、`byStatus.rejected` が `{"count":1,"totalAmount":2000}`、`byStatus.pending` が `{"count":1,"totalAmount":3000}` である

#### Scenario: 経費の日付で月を判定する
- **WHEN** `date` が `2026-10-31` の申請と `2026-12-01` の申請と `2026-11-10` の申請がある状態で、承認者が `month=2026-11` の集計を取得する
- **THEN** `date` が `2026-11-10` の申請だけが集計される（申請を作成した日時には関係しない）

#### Scenario: すべての申請者の申請が対象になる
- **WHEN** 申請者 `u1` と `u2` がそれぞれ同じ月の日付で申請した後、承認者がその月の集計を取得する
- **THEN** 両方の申請が `count` と `totalAmount` に含まれる

#### Scenario: 該当する申請がない
- **WHEN** 指定した月の日付の申請が 1 件もない状態で、承認者が集計を取得する
- **THEN** ステータス 200 が返り、`count` と `totalAmount` が `0`、`byStatus` の 3 つの状態すべてが `{"count":0,"totalAmount":0}` である

### Requirement: 集計の権限
システムは、ロールが `applicant` の利用者が `GET /expense-claims/summary` を呼んだ場合、`month` の値に関わらず集計を行わずにステータス 403 を返さなければならない（SHALL）。

#### Scenario: 申請者は集計を見られない
- **WHEN** ロールが `applicant` の利用者が `month=2026-11` で集計 API を呼ぶ
- **THEN** ステータス 403 が返る

#### Scenario: 申請者が不正な月で呼ぶ
- **WHEN** ロールが `applicant` の利用者が `month` を付けずに集計 API を呼ぶ
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

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

let app;

beforeEach(() => {
  app = buildApp();
});

afterEach(async () => {
  await app.close();
});

const as = (id, role) => ({ 'x-user-id': id, 'x-user-role': role });
const applicant = (id = 'u1') => as(id, 'applicant');
const approver = (id = 'a1') => as(id, 'approver');

const validBody = { date: '2026-11-01', amount: 1200, description: 'タクシー代' };

function createClaim(headers = applicant(), body = validBody) {
  return app.inject({ method: 'POST', url: '/expense-claims', headers, payload: body });
}

async function listClaims(headers) {
  const res = await app.inject({ method: 'GET', url: '/expense-claims', headers });
  assert.equal(res.statusCode, 200);
  return res.json();
}

const validReject = { reason: '領収書がありません' };

// payload を省略すると本文なしで送る
function decide(action, id, headers = approver(), payload) {
  const options = { method: 'POST', url: `/expense-claims/${id}/${action}`, headers };
  if (payload !== undefined) options.payload = payload;
  return app.inject(options);
}

const validResubmit = {
  date: '2026-11-02',
  amount: 1500,
  description: 'タクシー代（領収書添付）',
  resubmitNote: '領収書を添付しました',
};

function resubmit(id, headers = applicant(), payload = validResubmit) {
  return app.inject({
    method: 'POST',
    url: `/expense-claims/${id}/resubmit`,
    headers,
    payload,
  });
}

// 本文なしで取り下げ API を呼ぶ
function withdraw(id, headers = applicant()) {
  return app.inject({ method: 'POST', url: `/expense-claims/${id}/withdraw`, headers });
}

// 申請を作成して取り下げ、取り下げ後の申請を返す
async function createWithdrawn(headers = applicant(), body = validBody) {
  const { id } = (await createClaim(headers, body)).json();
  const res = await withdraw(id, headers);
  assert.equal(res.statusCode, 200);
  return res.json();
}

const findClaim = async (id, headers = approver()) =>
  (await listClaims(headers)).find((c) => c.id === id);

// 申請を作成して差戻し、差戻し後の申請を返す
async function createRejected(headers = applicant(), body = validBody) {
  const { id } = (await createClaim(headers, body)).json();
  const res = await decide('reject', id, approver(), validReject);
  assert.equal(res.statusCode, 200);
  return res.json();
}

describe('利用者の識別', () => {
  test('ヘッダーがない', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/expense-claims',
      headers: { 'x-user-role': 'applicant' },
    });
    assert.equal(res.statusCode, 401);
  });

  test('ロールが不正', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/expense-claims',
      headers: as('u1', 'admin'),
    });
    assert.equal(res.statusCode, 401);
  });

  test('ヘッダーがなく本文も不正な場合は 400 より先に 401 を返す', async () => {
    const res = await app.inject({ method: 'POST', url: '/expense-claims', payload: {} });
    assert.equal(res.statusCode, 401);
  });

  test('/health はヘッダーなしで応答する', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
  });
});

describe('経費の申請', () => {
  test('申請に成功する', async () => {
    const res = await createClaim(applicant('u1'));
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(typeof body.id, 'number');
    assert.equal(body.applicantId, 'u1');
    assert.equal(body.status, 'pending');
    assert.equal(body.date, '2026-11-01');
    assert.equal(body.amount, 1200);
    assert.equal(body.description, 'タクシー代');
    assert.equal(body.withdrawnAt, null);
  });

  test('承認者は申請できない', async () => {
    const res = await createClaim(approver());
    assert.equal(res.statusCode, 403);
    assert.deepEqual(await listClaims(approver()), []);
  });

  test('承認者が不正な本文を送っても 400 より先に 403 を返す', async () => {
    const res = await createClaim(approver(), {});
    assert.equal(res.statusCode, 403);
  });

  test('description は trim して保存する', async () => {
    const res = await createClaim(applicant(), { ...validBody, description: '  会議費  ' });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().description, '会議費');
  });
});

describe('申請内容の検証', () => {
  async function assertRejected(body) {
    const res = await createClaim(applicant(), body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.deepEqual(await listClaims(approver()), []);
  }

  test('金額が 0 以下', async () => {
    await assertRejected({ ...validBody, amount: 0 });
    await assertRejected({ ...validBody, amount: -100 });
  });

  test('金額が上限を超える', async () => {
    await assertRejected({ ...validBody, amount: 1000001 });
  });

  test('金額が上限ちょうど', async () => {
    const res = await createClaim(applicant(), { ...validBody, amount: 1000000 });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().amount, 1000000);
  });

  test('金額が整数でない', async () => {
    await assertRejected({ ...validBody, amount: 100.5 });
    await assertRejected({ ...validBody, amount: '100' });
  });

  test('存在しない日付', async () => {
    await assertRejected({ ...validBody, date: '2026-02-30' });
    await assertRejected({ ...validBody, date: '2026-13-01' });
    await assertRejected({ ...validBody, date: '2026/11/01' });
  });

  test('うるう日は受け付ける', async () => {
    const res = await createClaim(applicant(), { ...validBody, date: '2028-02-29' });
    assert.equal(res.statusCode, 201);
  });

  test('内容が空', async () => {
    await assertRejected({ ...validBody, description: '' });
    await assertRejected({ ...validBody, description: '   ' });
  });

  test('内容が 200 文字を超える', async () => {
    await assertRejected({ ...validBody, description: 'あ'.repeat(201) });
    const res = await createClaim(applicant(), { ...validBody, description: 'あ'.repeat(200) });
    assert.equal(res.statusCode, 201);
  });

  test('必須項目がない', async () => {
    for (const key of ['date', 'amount', 'description']) {
      const body = { ...validBody };
      delete body[key];
      await assertRejected(body);
    }
  });
});

describe('申請の一覧', () => {
  test('申請者は自分の申請だけを見る', async () => {
    await createClaim(applicant('u1'));
    await createClaim(applicant('u2'));
    const claims = await listClaims(applicant('u1'));
    assert.equal(claims.length, 1);
    assert.equal(claims[0].applicantId, 'u1');
  });

  test('承認者はすべての申請を見る', async () => {
    const first = (await createClaim(applicant('u1'))).json();
    const second = (await createClaim(applicant('u2'))).json();
    const claims = await listClaims(approver());
    assert.deepEqual(
      claims.map((c) => c.id),
      [second.id, first.id],
    );
    assert.deepEqual(Object.keys(claims[0]).sort(), [
      'amount',
      'applicantId',
      'createdAt',
      'date',
      'decidedAt',
      'decidedBy',
      'description',
      'id',
      'rejectReason',
      'resubmitNote',
      'resubmittedFrom',
      'status',
      'withdrawnAt',
    ]);
    assert.equal(claims[0].decidedBy, null);
    assert.equal(claims[0].decidedAt, null);
    assert.equal(claims[0].rejectReason, null);
    assert.equal(claims[0].resubmittedFrom, null);
    assert.equal(claims[0].resubmitNote, null);
  });

  test('申請がない', async () => {
    assert.deepEqual(await listClaims(approver()), []);
  });

  test('差戻し理由が一覧に含まれる', async () => {
    const { id } = (await createClaim(applicant('u1'))).json();
    await decide('reject', id, approver(), validReject);
    const [claim] = await listClaims(applicant('u1'));
    assert.equal(claim.rejectReason, '領収書がありません');
  });

  test('差戻されていない申請の理由は null', async () => {
    const approved = (await createClaim()).json();
    await createClaim();
    await decide('approve', approved.id);
    const claims = await listClaims(approver());
    assert.deepEqual(
      claims.map((c) => c.status).sort(),
      ['approved', 'pending'],
    );
    assert.ok(claims.every((c) => c.rejectReason === null));
  });

  test('出し直しの紐付けが一覧に含まれる', async () => {
    const source = await createRejected(applicant('u1'));
    const created = (await resubmit(source.id, applicant('u1'))).json();
    const claims = await listClaims(applicant('u1'));
    const resubmitted = claims.find((c) => c.id === created.id);
    const original = claims.find((c) => c.id === source.id);
    assert.equal(resubmitted.resubmittedFrom, source.id);
    assert.equal(resubmitted.resubmitNote, '領収書を添付しました');
    assert.equal(original.resubmittedFrom, null);
    assert.equal(original.resubmitNote, null);
  });

  test('取り下げていない申請の取り下げ日時は null', async () => {
    await createClaim();
    const approved = (await createClaim()).json();
    await decide('approve', approved.id);
    await createRejected();
    const claims = await listClaims(approver());
    assert.deepEqual(
      claims.map((c) => c.status).sort(),
      ['approved', 'pending', 'rejected'],
    );
    assert.ok(claims.every((c) => c.withdrawnAt === null));
  });
});

// query はクエリ文字列（先頭の ? を除く）。undefined のときはクエリを付けない
function listWithQuery(query, headers = approver()) {
  const url = query === undefined ? '/expense-claims' : `/expense-claims?${query}`;
  return app.inject({ method: 'GET', url, headers });
}

describe('一覧の状態による絞り込み', () => {
  // 申請者ごとに未判断・承認済み・差戻しの申請を 1 件ずつ作る（この順で作成する）
  async function createInEachStatus(headers) {
    const pending = (await createClaim(headers)).json();
    const approved = (await createClaim(headers)).json();
    await decide('approve', approved.id);
    const rejected = await createRejected(headers);
    return { pending, approved, rejected };
  }

  test('承認者が未判断の申請だけを見る', async () => {
    const u1 = await createInEachStatus(applicant('u1'));
    const u2 = await createInEachStatus(applicant('u2'));
    const res = await listWithQuery('status=pending');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      res.json().map((c) => c.id),
      [u2.pending.id, u1.pending.id],
    );
  });

  test('申請者は自分の申請の中から絞り込む', async () => {
    const u1 = await createInEachStatus(applicant('u1'));
    await createInEachStatus(applicant('u2'));
    const res = await listWithQuery('status=approved', applicant('u1'));
    assert.equal(res.statusCode, 200);
    const claims = res.json();
    assert.deepEqual(
      claims.map((c) => c.id),
      [u1.approved.id],
    );
    assert.equal(claims[0].applicantId, 'u1');
    assert.equal(claims[0].status, 'approved');
  });

  test('差戻しで絞り込むと出し直された元の申請も含まれる', async () => {
    const source = await createRejected();
    const created = await resubmit(source.id);
    assert.equal(created.statusCode, 201);
    const res = await listWithQuery('status=rejected');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      res.json().map((c) => c.id),
      [source.id],
    );
  });

  test('取り下げた申請だけを見る', async () => {
    await createClaim();
    const withdrawn = await createWithdrawn();
    const res = await listWithQuery('status=withdrawn');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      res.json().map((c) => c.id),
      [withdrawn.id],
    );
  });

  test('未判断で絞り込むと取り下げた申請は含まれない', async () => {
    const pending = (await createClaim()).json();
    await createWithdrawn();
    const res = await listWithQuery('status=pending');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      res.json().map((c) => c.id),
      [pending.id],
    );
  });

  test('該当する申請がない', async () => {
    await createClaim();
    await createClaim();
    const res = await listWithQuery('status=approved');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), []);
  });

  test('指定しない場合はすべての状態を返す', async () => {
    await createInEachStatus(applicant('u1'));
    await createWithdrawn(applicant('u1'));
    const res = await listWithQuery(undefined);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      res.json().map((c) => c.status).sort(),
      ['approved', 'pending', 'rejected', 'withdrawn'],
    );
  });
});

describe('絞り込む状態の検証', () => {
  async function assertBadStatus(query) {
    await createClaim();
    const res = await listWithQuery(query);
    assert.equal(res.statusCode, 400, query);
    return res;
  }

  test('存在しない状態', async () => {
    const res = await assertBadStatus('status=draft');
    const body = res.json();
    assert.deepEqual(Object.keys(body).sort(), ['error', 'message', 'statusCode']);
    assert.equal(body.statusCode, 400);
    assert.equal(body.error, 'Bad Request');
    assert.equal(
      body.message,
      'status は pending・approved・rejected・withdrawn のいずれか 1 つでなければなりません',
    );
  });

  test('空の値', async () => {
    await assertBadStatus('status=');
  });

  test('大文字で指定する', async () => {
    await assertBadStatus('status=PENDING');
    await assertBadStatus('status=WITHDRAWN');
  });

  test('複数の状態を指定する', async () => {
    await assertBadStatus('status=pending&status=rejected');
    await assertBadStatus('status=pending,rejected');
    await assertBadStatus('status=pending,withdrawn');
  });

  test('ヘッダーがなく状態も不正', async () => {
    const res = await listWithQuery('status=draft', {});
    assert.equal(res.statusCode, 401);
  });
});

describe('申請の承認・差戻し', () => {
  test('承認に成功する', async () => {
    const { id } = (await createClaim()).json();
    const res = await decide('approve', id, approver('a1'));
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'approved');
    assert.equal(body.decidedBy, 'a1');
    assert.ok(body.decidedAt);
    assert.equal(body.withdrawnAt, null);
  });

  test('差戻しに成功する', async () => {
    const { id } = (await createClaim()).json();
    const res = await decide('reject', id, approver('a1'), validReject);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'rejected');
    assert.equal(body.decidedBy, 'a1');
    assert.ok(body.decidedAt);
    assert.equal(body.rejectReason, '領収書がありません');
    assert.equal(body.withdrawnAt, null);
  });

  test('理由は前後の空白を除いて記録される', async () => {
    const { id } = (await createClaim()).json();
    const res = await decide('reject', id, approver(), { reason: '  金額が誤っています  ' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().rejectReason, '金額が誤っています');
  });

  test('申請者は approve できない', async () => {
    const { id } = (await createClaim()).json();
    const res = await decide('approve', id, applicant());
    assert.equal(res.statusCode, 403);
    const [claim] = await listClaims(approver());
    assert.equal(claim.status, 'pending');
  });

  test('申請者は本文に関わらず reject できない', async () => {
    const { id } = (await createClaim()).json();
    for (const payload of [validReject, undefined, {}, { reason: '' }, { reason: 123 }]) {
      const res = await decide('reject', id, applicant(), payload);
      assert.equal(res.statusCode, 403, JSON.stringify(payload));
    }
    const [claim] = await listClaims(approver());
    assert.equal(claim.status, 'pending');
  });

  test('承認済みの申請を差戻そうとする', async () => {
    const { id } = (await createClaim()).json();
    await decide('approve', id);
    const res = await decide('reject', id, approver(), validReject);
    assert.equal(res.statusCode, 409);
    const [claim] = await listClaims(approver());
    assert.equal(claim.status, 'approved');
    assert.equal(claim.rejectReason, null);
  });

  test('差戻し済みの申請を承認しようとする', async () => {
    const { id } = (await createClaim()).json();
    await decide('reject', id, approver(), validReject);
    const res = await decide('approve', id);
    assert.equal(res.statusCode, 409);
    const [claim] = await listClaims(approver());
    assert.equal(claim.status, 'rejected');
  });

  test('差戻し済みの申請をもう一度差戻そうとする', async () => {
    const { id } = (await createClaim()).json();
    await decide('reject', id, approver(), validReject);
    const res = await decide('reject', id, approver(), { reason: '別の理由' });
    assert.equal(res.statusCode, 409);
    const [claim] = await listClaims(approver());
    assert.equal(claim.rejectReason, '領収書がありません');
  });

  test('出し直された元の申請も承認できない', async () => {
    const source = await createRejected();
    assert.equal((await resubmit(source.id)).statusCode, 201);
    const res = await decide('approve', source.id);
    assert.equal(res.statusCode, 409);
    const original = (await listClaims(approver())).find((c) => c.id === source.id);
    assert.equal(original.status, 'rejected');
  });

  test('取り下げた申請は承認できない', async () => {
    const { id } = await createWithdrawn();
    const res = await decide('approve', id);
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().message, '申請はすでに withdrawn のため変更できません');
    const claim = await findClaim(id);
    assert.equal(claim.status, 'withdrawn');
    assert.equal(claim.decidedBy, null);
    assert.equal(claim.decidedAt, null);
  });

  test('取り下げた申請は差戻しできない', async () => {
    const { id } = await createWithdrawn();
    const res = await decide('reject', id, approver(), validReject);
    assert.equal(res.statusCode, 409);
    const claim = await findClaim(id);
    assert.equal(claim.status, 'withdrawn');
    assert.equal(claim.rejectReason, null);
  });

  test('存在しない ID を承認する', async () => {
    assert.equal((await decide('approve', 999)).statusCode, 404);
    assert.equal((await decide('reject', 999, approver(), validReject)).statusCode, 404);
    assert.equal((await decide('approve', 'abc')).statusCode, 404);
  });
});

describe('差戻し理由の検証', () => {
  async function assertRejectFails(payload) {
    const { id } = (await createClaim()).json();
    const res = await decide('reject', id, approver(), payload);
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    const claim = (await listClaims(approver())).find((c) => c.id === id);
    assert.equal(claim.status, 'pending');
    assert.equal(claim.rejectReason, null);
  }

  test('理由がない', async () => {
    await assertRejectFails(undefined);
    await assertRejectFails({});
  });

  test('理由が空', async () => {
    await assertRejectFails({ reason: '' });
    await assertRejectFails({ reason: '   ' });
  });

  test('理由が文字列でない', async () => {
    await assertRejectFails({ reason: 123 });
  });

  test('理由が 500 文字を超える', async () => {
    await assertRejectFails({ reason: ` ${'あ'.repeat(501)} ` });
  });

  test('理由が 500 文字ちょうど', async () => {
    const { id } = (await createClaim()).json();
    const reason = 'あ'.repeat(500);
    const res = await decide('reject', id, approver(), { reason: `  ${reason}  ` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().rejectReason, reason);
  });
});

describe('差戻しの検証の順序', () => {
  test('存在しない申請に不正な理由で差戻す', async () => {
    const res = await decide('reject', 999, approver(), { reason: '' });
    assert.equal(res.statusCode, 400);
  });
});

describe('差戻された申請の出し直し', () => {
  test('出し直しに成功する', async () => {
    const source = await createRejected(applicant('u1'));
    const res = await resubmit(source.id, applicant('u1'));
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(typeof body.id, 'number');
    assert.notEqual(body.id, source.id);
    assert.equal(body.applicantId, 'u1');
    assert.equal(body.status, 'pending');
    assert.equal(body.resubmittedFrom, source.id);
    assert.equal(body.resubmitNote, '領収書を添付しました');
    assert.equal(body.decidedBy, null);
    assert.equal(body.decidedAt, null);
    assert.equal(body.rejectReason, null);
    assert.equal(body.date, '2026-11-02');
    assert.equal(body.amount, 1500);
    assert.equal(body.description, 'タクシー代（領収書添付）');
    assert.equal(body.withdrawnAt, null);
  });

  test('resubmitNote は前後の空白を除いて記録される', async () => {
    const source = await createRejected();
    const res = await resubmit(source.id, applicant(), {
      ...validResubmit,
      resubmitNote: '  金額を直しました  ',
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().resubmitNote, '金額を直しました');
  });

  test('元の申請は差戻しのまま残る', async () => {
    const source = await createRejected(applicant('u1'));
    const created = (await resubmit(source.id, applicant('u1'))).json();
    const claims = await listClaims(applicant('u1'));
    assert.deepEqual(
      claims.map((c) => c.id).sort((a, b) => a - b),
      [source.id, created.id].sort((a, b) => a - b),
    );
    const original = claims.find((c) => c.id === source.id);
    assert.equal(original.status, 'rejected');
    assert.equal(original.decidedBy, source.decidedBy);
    assert.equal(original.decidedAt, source.decidedAt);
    assert.equal(original.rejectReason, '領収書がありません');
  });
});

describe('出し直しの権限', () => {
  test('承認者は出し直せない', async () => {
    const source = await createRejected();
    const res = await resubmit(source.id, approver());
    assert.equal(res.statusCode, 403);
    assert.equal((await listClaims(approver())).length, 1);
  });

  test('他人の申請は出し直せない', async () => {
    const source = await createRejected(applicant('u1'));
    const res = await resubmit(source.id, applicant('u2'));
    assert.equal(res.statusCode, 404);
    assert.equal((await listClaims(approver())).length, 1);
  });

  test('他人の差戻されていない申請も 404 になる', async () => {
    const { id } = (await createClaim(applicant('u1'))).json();
    const res = await resubmit(id, applicant('u2'));
    assert.equal(res.statusCode, 404);
  });

  test('存在しない申請を出し直す', async () => {
    assert.equal((await resubmit(999)).statusCode, 404);
    assert.equal((await resubmit('abc')).statusCode, 404);
  });
});

describe('出し直しの内容の検証', () => {
  async function assertResubmitFails(payload) {
    const source = await createRejected();
    const res = await resubmit(source.id, applicant(), payload);
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    const claims = await listClaims(approver());
    assert.ok(claims.every((c) => c.resubmittedFrom !== source.id), JSON.stringify(payload));
  }

  test('金額が不正', async () => {
    await assertResubmitFails({ ...validResubmit, amount: 0 });
  });

  test('必須項目がない', async () => {
    const body = { ...validResubmit };
    delete body.description;
    await assertResubmitFails(body);
  });

  test('存在しない申請に不正な本文で出し直す', async () => {
    const res = await resubmit(999, applicant(), { ...validResubmit, date: '2026-02-30' });
    assert.equal(res.statusCode, 400);
  });

  test('直した内容のメモがない', async () => {
    const body = { ...validResubmit };
    delete body.resubmitNote;
    await assertResubmitFails(body);
  });

  test('直した内容のメモが空白だけ', async () => {
    await assertResubmitFails({ ...validResubmit, resubmitNote: '   ' });
  });

  test('直した内容のメモが 200 文字を超える', async () => {
    await assertResubmitFails({ ...validResubmit, resubmitNote: ` ${'あ'.repeat(201)} ` });
  });

  test('直した内容のメモが 200 文字ちょうど', async () => {
    const source = await createRejected();
    const note = 'あ'.repeat(200);
    const res = await resubmit(source.id, applicant(), { ...validResubmit, resubmitNote: note });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().resubmitNote, note);
  });
});

describe('出し直しできる申請', () => {
  test('未判断の申請は出し直せない', async () => {
    const { id } = (await createClaim()).json();
    const res = await resubmit(id);
    assert.equal(res.statusCode, 409);
    assert.equal((await listClaims(approver())).length, 1);
  });

  test('承認済みの申請は出し直せない', async () => {
    const { id } = (await createClaim()).json();
    await decide('approve', id);
    const res = await resubmit(id);
    assert.equal(res.statusCode, 409);
    assert.equal((await listClaims(approver())).length, 1);
  });

  test('取り下げた申請は出し直せない', async () => {
    const { id } = await createWithdrawn();
    const res = await resubmit(id);
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().message, '申請はすでに withdrawn のため変更できません');
    assert.equal((await listClaims(approver())).length, 1);
  });

  test('出し直した申請を取り下げても、元の申請はもう出し直せない', async () => {
    const source = await createRejected();
    const second = (await resubmit(source.id)).json();
    assert.equal((await withdraw(second.id)).statusCode, 200);
    const res = await resubmit(source.id);
    assert.equal(res.statusCode, 409);
    assert.equal((await listClaims(approver())).length, 2);
  });

  test('同じ申請を 2 回出し直せない', async () => {
    const source = await createRejected();
    assert.equal((await resubmit(source.id)).statusCode, 201);
    const res = await resubmit(source.id);
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().message, 'この申請はすでに出し直されています');
    const claims = await listClaims(approver());
    assert.equal(claims.filter((c) => c.resubmittedFrom === source.id).length, 1);
  });

  test('出し直した申請が差戻されたら、さらに出し直せる', async () => {
    const source = await createRejected();
    const second = (await resubmit(source.id)).json();
    await decide('reject', second.id, approver(), { reason: '金額が誤っています' });
    const res = await resubmit(second.id, applicant(), {
      ...validResubmit,
      resubmitNote: '金額を直しました',
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().resubmittedFrom, second.id);
  });
});

describe('申請の取り下げ', () => {
  test('取り下げに成功する', async () => {
    const created = (await createClaim(applicant('u1'))).json();
    const res = await withdraw(created.id, applicant('u1'));
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.id, created.id);
    assert.equal(body.status, 'withdrawn');
    assert.equal(typeof body.withdrawnAt, 'string');
    assert.equal(body.decidedBy, null);
    assert.equal(body.decidedAt, null);
    assert.equal(body.rejectReason, null);
    assert.equal(body.date, created.date);
    assert.equal(body.amount, created.amount);
    assert.equal(body.description, created.description);
  });

  test('取り下げた申請は一覧に残る', async () => {
    const withdrawn = await createWithdrawn(applicant('u1'));
    const claims = await listClaims(applicant('u1'));
    const claim = claims.find((c) => c.id === withdrawn.id);
    assert.ok(claim);
    assert.equal(claim.status, 'withdrawn');
  });

  test('出し直した申請も取り下げられる', async () => {
    const source = await createRejected(applicant('u1'));
    const second = (await resubmit(source.id, applicant('u1'))).json();
    const res = await withdraw(second.id, applicant('u1'));
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, 'withdrawn');
    assert.equal(res.json().resubmittedFrom, source.id);
    assert.equal((await findClaim(source.id)).status, 'rejected');
  });
});

describe('取り下げの権限', () => {
  test('承認者は取り下げられない', async () => {
    const { id } = (await createClaim()).json();
    const res = await withdraw(id, approver());
    assert.equal(res.statusCode, 403);
    assert.equal((await findClaim(id)).status, 'pending');
  });

  test('他人の申請は取り下げられない', async () => {
    const { id } = (await createClaim(applicant('u1'))).json();
    const res = await withdraw(id, applicant('u2'));
    assert.equal(res.statusCode, 404);
    assert.equal((await findClaim(id)).status, 'pending');
  });

  test('他人の判断済みの申請も 404 になる', async () => {
    const { id } = (await createClaim(applicant('u1'))).json();
    await decide('approve', id);
    const res = await withdraw(id, applicant('u2'));
    assert.equal(res.statusCode, 404);
  });

  test('存在しない申請を取り下げる', async () => {
    assert.equal((await withdraw(999)).statusCode, 404);
    assert.equal((await withdraw('abc')).statusCode, 404);
  });
});

describe('取り下げできる申請', () => {
  test('承認済みの申請は取り下げられない', async () => {
    const { id } = (await createClaim()).json();
    await decide('approve', id);
    const res = await withdraw(id);
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().message, '申請はすでに approved のため変更できません');
    const claim = await findClaim(id);
    assert.equal(claim.status, 'approved');
    assert.equal(claim.withdrawnAt, null);
  });

  test('差戻された申請は取り下げられない', async () => {
    const { id } = await createRejected();
    const res = await withdraw(id);
    assert.equal(res.statusCode, 409);
    const claim = await findClaim(id);
    assert.equal(claim.status, 'rejected');
    assert.equal(claim.rejectReason, '領収書がありません');
  });

  test('同じ申請を 2 回取り下げられない', async () => {
    const first = await createWithdrawn();
    const res = await withdraw(first.id);
    assert.equal(res.statusCode, 409);
    assert.equal((await findClaim(first.id)).withdrawnAt, first.withdrawnAt);
  });
});

describe('月ごとの集計', () => {
  const zero = { count: 0, totalAmount: 0 };

  // month が undefined のときはクエリを付けない
  function getSummary(month, headers = approver()) {
    const url =
      month === undefined
        ? '/expense-claims/summary'
        : `/expense-claims/summary?month=${encodeURIComponent(month)}`;
    return app.inject({ method: 'GET', url, headers });
  }

  async function createOn(date, amount, headers = applicant()) {
    const res = await createClaim(headers, { ...validBody, date, amount });
    assert.equal(res.statusCode, 201);
    return res.json();
  }

  test('状態ごとに集計される', async () => {
    const approved = await createOn('2026-11-01', 1000);
    const rejected = await createOn('2026-11-15', 2000);
    await createOn('2026-11-30', 3000);
    const withdrawn = await createOn('2026-11-20', 4000);
    await decide('approve', approved.id);
    await decide('reject', rejected.id, approver(), validReject);
    assert.equal((await withdraw(withdrawn.id)).statusCode, 200);

    const res = await getSummary('2026-11');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      month: '2026-11',
      byStatus: {
        pending: { count: 1, totalAmount: 3000 },
        approved: { count: 1, totalAmount: 1000 },
        rejected: { count: 1, totalAmount: 2000 },
        withdrawn: { count: 1, totalAmount: 4000 },
      },
    });
  });

  test('取り下げた申請は未判断に数えない', async () => {
    await createOn('2026-11-10', 1000);
    const withdrawn = await createOn('2026-11-10', 500);
    assert.equal((await withdraw(withdrawn.id)).statusCode, 200);

    const res = await getSummary('2026-11');
    assert.equal(res.statusCode, 200);
    const { byStatus } = res.json();
    assert.deepEqual(byStatus.pending, { count: 1, totalAmount: 1000 });
    assert.deepEqual(byStatus.withdrawn, { count: 1, totalAmount: 500 });
  });

  test('経費の日付で月を判定する', async () => {
    await createOn('2026-10-31', 100);
    await createOn('2026-12-01', 200);
    await createOn('2026-11-10', 300);

    const res = await getSummary('2026-11');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().byStatus, {
      pending: { count: 1, totalAmount: 300 },
      approved: zero,
      rejected: zero,
      withdrawn: zero,
    });
  });

  test('すべての申請者の申請が対象になる', async () => {
    await createOn('2026-11-05', 1000, applicant('u1'));
    await createOn('2026-11-06', 2500, applicant('u2'));

    const res = await getSummary('2026-11');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().byStatus.pending, { count: 2, totalAmount: 3500 });
  });

  test('該当する申請がない', async () => {
    await createOn('2026-11-05', 1000);

    const res = await getSummary('2027-01');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      month: '2027-01',
      byStatus: { pending: zero, approved: zero, rejected: zero, withdrawn: zero },
    });
  });

  test('差戻した申請と出し直した申請は別々に数えられる', async () => {
    const source = await createRejected(applicant(), {
      ...validBody,
      date: '2026-11-15',
      amount: 2000,
    });
    const res = await resubmit(source.id, applicant(), {
      ...validResubmit,
      date: '2026-11-15',
      amount: 1800,
    });
    assert.equal(res.statusCode, 201);

    const summary = await getSummary('2026-11');
    assert.equal(summary.statusCode, 200);
    assert.deepEqual(summary.json().byStatus, {
      pending: { count: 1, totalAmount: 1800 },
      approved: zero,
      rejected: { count: 1, totalAmount: 2000 },
      withdrawn: zero,
    });
  });

  test('申請者は集計を見られない', async () => {
    const res = await getSummary('2026-11', applicant());
    assert.equal(res.statusCode, 403);
  });

  test('申請者が不正な月で呼ぶと 400 より先に 403 を返す', async () => {
    const res = await getSummary('2026-13', applicant());
    assert.equal(res.statusCode, 403);
  });

  test('月の指定がない', async () => {
    const res = await getSummary(undefined);
    assert.equal(res.statusCode, 400);
  });

  test('存在しない月', async () => {
    for (const month of ['2026-13', '2026-00']) {
      const res = await getSummary(month);
      assert.equal(res.statusCode, 400, month);
    }
  });

  test('形式が違う', async () => {
    for (const month of ['2026-1', '2026/11', '2026-11-01']) {
      const res = await getSummary(month);
      assert.equal(res.statusCode, 400, month);
    }
  });

  test('ヘッダーがない', async () => {
    const res = await getSummary('2026-11', {});
    assert.equal(res.statusCode, 401);
  });
});

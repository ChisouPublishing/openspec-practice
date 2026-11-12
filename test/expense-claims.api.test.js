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
      'status',
    ]);
    assert.equal(claims[0].decidedBy, null);
    assert.equal(claims[0].decidedAt, null);
    assert.equal(claims[0].rejectReason, null);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';

test('再起動後も申請が残る', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'expense-api-'));
  const dbPath = join(dir, 'expenses.db');
  try {
    const first = buildApp({ dbPath });
    const created = await first.inject({
      method: 'POST',
      url: '/expense-claims',
      headers: { 'x-user-id': 'u1', 'x-user-role': 'applicant' },
      payload: { date: '2026-11-01', amount: 1200, description: 'タクシー代' },
    });
    assert.equal(created.statusCode, 201);
    const { id } = created.json();
    const approved = await first.inject({
      method: 'POST',
      url: `/expense-claims/${id}/approve`,
      headers: { 'x-user-id': 'a1', 'x-user-role': 'approver' },
    });
    assert.equal(approved.statusCode, 200);
    await first.close();

    const second = buildApp({ dbPath });
    try {
      const res = await second.inject({
        method: 'GET',
        url: '/expense-claims',
        headers: { 'x-user-id': 'a1', 'x-user-role': 'approver' },
      });
      assert.equal(res.statusCode, 200);
      const claims = res.json();
      assert.equal(claims.length, 1);
      assert.equal(claims[0].id, id);
      assert.equal(claims[0].status, 'approved');
      assert.equal(claims[0].decidedBy, 'a1');
    } finally {
      await second.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('再起動後も差戻し理由が残る', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'expense-api-'));
  const dbPath = join(dir, 'expenses.db');
  try {
    const first = buildApp({ dbPath });
    const created = await first.inject({
      method: 'POST',
      url: '/expense-claims',
      headers: { 'x-user-id': 'u1', 'x-user-role': 'applicant' },
      payload: { date: '2026-11-01', amount: 1200, description: 'タクシー代' },
    });
    assert.equal(created.statusCode, 201);
    const { id } = created.json();
    const rejected = await first.inject({
      method: 'POST',
      url: `/expense-claims/${id}/reject`,
      headers: { 'x-user-id': 'a1', 'x-user-role': 'approver' },
      payload: { reason: '領収書がありません' },
    });
    assert.equal(rejected.statusCode, 200);
    await first.close();

    const second = buildApp({ dbPath });
    try {
      const res = await second.inject({
        method: 'GET',
        url: '/expense-claims',
        headers: { 'x-user-id': 'u1', 'x-user-role': 'applicant' },
      });
      assert.equal(res.statusCode, 200);
      const claims = res.json();
      assert.equal(claims.length, 1);
      assert.equal(claims[0].id, id);
      assert.equal(claims[0].status, 'rejected');
      assert.equal(claims[0].rejectReason, '領収書がありません');
    } finally {
      await second.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('再起動後も出し直しの紐付けとメモが残り、同じ申請は再度出し直せない', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'expense-api-'));
  const dbPath = join(dir, 'expenses.db');
  const applicantHeaders = { 'x-user-id': 'u1', 'x-user-role': 'applicant' };
  const resubmitBody = {
    date: '2026-11-02',
    amount: 1500,
    description: 'タクシー代（領収書添付）',
    resubmitNote: '領収書を添付しました',
  };
  try {
    const first = buildApp({ dbPath });
    const created = await first.inject({
      method: 'POST',
      url: '/expense-claims',
      headers: applicantHeaders,
      payload: { date: '2026-11-01', amount: 1200, description: 'タクシー代' },
    });
    assert.equal(created.statusCode, 201);
    const { id } = created.json();
    const rejected = await first.inject({
      method: 'POST',
      url: `/expense-claims/${id}/reject`,
      headers: { 'x-user-id': 'a1', 'x-user-role': 'approver' },
      payload: { reason: '領収書がありません' },
    });
    assert.equal(rejected.statusCode, 200);
    const resubmitted = await first.inject({
      method: 'POST',
      url: `/expense-claims/${id}/resubmit`,
      headers: applicantHeaders,
      payload: resubmitBody,
    });
    assert.equal(resubmitted.statusCode, 201);
    const newId = resubmitted.json().id;
    await first.close();

    const second = buildApp({ dbPath });
    try {
      const res = await second.inject({
        method: 'GET',
        url: '/expense-claims',
        headers: applicantHeaders,
      });
      assert.equal(res.statusCode, 200);
      const claims = res.json();
      assert.equal(claims.length, 2);
      const claim = claims.find((c) => c.id === newId);
      assert.equal(claim.resubmittedFrom, id);
      assert.equal(claim.resubmitNote, '領収書を添付しました');

      const again = await second.inject({
        method: 'POST',
        url: `/expense-claims/${id}/resubmit`,
        headers: applicantHeaders,
        payload: resubmitBody,
      });
      assert.equal(again.statusCode, 409);
    } finally {
      await second.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

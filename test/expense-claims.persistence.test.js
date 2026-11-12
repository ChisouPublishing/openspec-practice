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

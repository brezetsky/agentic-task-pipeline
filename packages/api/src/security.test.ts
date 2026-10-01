import express from 'express';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { authenticate, StartRequestSchema } from './security.js';
import { DecisionSchema } from '@pipeline/core';

it('enforces bearer auth over HTTP without leaking credentials', async () => {
  const app = express();
  app.use(authenticate('a'.repeat(32)));
  app.get('/', (_req, res) => {
    res.json({ ok: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    expect(
      (await fetch(url, { headers: { authorization: `Bearer ${'a'.repeat(32)}` } })).status,
    ).toBe(200);
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});
it('requires exactly one bounded task and a revision-bound decision', () => {
  expect(StartRequestSchema.safeParse({ taskId: '../escape' }).success).toBe(false);
  expect(StartRequestSchema.safeParse({ taskId: 'ok', autoApprove: true }).success).toBe(false);
  expect(StartRequestSchema.safeParse({ taskId: 'ok' }).success).toBe(true);
  expect(DecisionSchema.safeParse({ kind: 'approve' }).success).toBe(false);
  expect(DecisionSchema.safeParse({ kind: 'approve', planRevision: 0 }).success).toBe(true);
});

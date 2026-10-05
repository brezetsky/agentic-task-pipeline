import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { loadConfig } from '@pipeline/core';
import { createApp } from './server.js';
import { startRun, sendDecision, getRunStatus } from './temporal.js';
vi.mock('./temporal.js', () => ({
  startRun: vi.fn().mockResolvedValue('run-CARD-101'),
  sendDecision: vi.fn().mockResolvedValue(undefined),
  getRunStatus: vi.fn().mockResolvedValue(null),
  listRuns: vi.fn().mockResolvedValue([]),
  getClient: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());
it('validates/authenticates actual routes and keeps backend errors private', async () => {
  const token = 'a'.repeat(32);
  const app = createApp(loadConfig({ API_AUTH_TOKEN: token }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const post = (path: string, body: unknown) =>
    fetch(url + path, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    expect((await fetch(url + '/api/health')).status).toBe(200);
    expect((await fetch(url + '/api/info')).status).toBe(401);
    expect((await post('/api/runs', { taskId: '../escape' })).status).toBe(400);
    expect(startRun).not.toHaveBeenCalled();
    expect((await post('/api/runs', { taskId: 'CARD-101' })).status).toBe(201);
    expect(startRun).toHaveBeenCalledTimes(1);
    expect((await post('/api/runs/run-CARD-101/decision', { kind: 'approve' })).status).toBe(400);
    expect(sendDecision).not.toHaveBeenCalled();
    expect(
      (await post('/api/runs/run-CARD-101/decision', { kind: 'approve', planRevision: 0 })).status,
    ).toBe(200);
    expect((await post('/api/runs', { taskId: 'x'.repeat(150_000) })).status).toBe(413);
    vi.mocked(getRunStatus).mockRejectedValueOnce(new Error('secret-provider-token'));
    const response = await fetch(url + '/api/runs/missing', { headers });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret-provider-token');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});

it('separates read, start and review permissions and attributes decisions to authenticated identities', async () => {
  const { createHash } = await import('node:crypto');
  const principals = ['viewer', 'operator', 'reviewer'].map((role) => ({
    id: role,
    roles: [role],
    tokenSha256: createHash('sha256').update(role.repeat(12)).digest('hex'),
  }));
  const app = createApp(loadConfig({ API_PRINCIPALS: JSON.stringify(principals) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (role: string, path: string, body?: unknown) =>
    fetch(url + path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${role.repeat(12)}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    expect((await request('unknown', '/api/runs')).status).toBe(401);
    for (const role of ['viewer', 'operator', 'reviewer']) {
      expect((await request(role, '/api/runs')).status).toBe(200);
      const info = (await (await request(role, '/api/info')).json()) as { access: { id: string } };
      expect(info.access.id).toBe(role);
      expect(JSON.stringify(info)).not.toContain('tokenSha256');
      expect((await request(role, '/api/runs', { taskId: 'CARD-101' })).status).toBe(
        role === 'operator' ? 201 : 403,
      );
      expect(
        (
          await request(role, '/api/runs/run-CARD-101/decision', {
            kind: 'approve',
            planRevision: 0,
            actor: 'forged-admin',
          })
        ).status,
      ).toBe(role === 'reviewer' ? 200 : 403);
    }
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(sendDecision).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendDecision).mock.calls[0][2].actor).toBe('reviewer');
    expect((await fetch(url + '/api/runs/run-CARD-101/events')).status).toBe(401);
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});

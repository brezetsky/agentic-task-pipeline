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

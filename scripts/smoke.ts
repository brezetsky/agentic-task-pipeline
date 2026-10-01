import assert from 'node:assert/strict';
import type { RunStatus } from '@pipeline/core';

class HttpError extends Error {
  constructor(
    public readonly status: number,
    path: string,
  ) {
    super(`${path}: HTTP ${status}`);
  }
}

/** Exercises a running local stack over HTTP, with real worker Git/test activities. */
async function main() {
  const base = 'http://127.0.0.1:3001/api';
  async function request<T = unknown>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new HttpError(response.status, path);
    return response.json() as Promise<T>;
  }
  let ready = false;
  for (const deadline = Date.now() + 120_000; Date.now() < deadline;) {
    try {
      await request('/ready');
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  assert(ready, 'Temporal/API did not become ready');
  const info = await request<{ mode: string }>('/info');
  assert.equal(info.mode, 'mock', 'Smoke test requires mock providers; refusing live side effects');
  const input = {
    task: {
      id: `smoke-${Date.now()}`,
      title: 'Document local addition behavior',
      description: 'Add a short note describing the sample sum function.',
      source: 'smoke',
    },
  };
  let runId: string | undefined;
  for (const deadline = Date.now() + 120_000; Date.now() < deadline;) {
    try {
      // Connectivity can precede namespace initialization on a cold Temporal start.
      // Keep the task ID stable: startRun is idempotent if a response was lost.
      ({ runId } = await request<{ runId: string }>('/runs', input));
      break;
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 503) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  assert(runId, 'Temporal did not accept the workflow before the startup deadline');
  async function waitFor(predicate: (s: RunStatus) => boolean): Promise<RunStatus> {
    for (const deadline = Date.now() + 120_000; Date.now() < deadline;) {
      const status = await request<RunStatus>(`/runs/${runId}`).catch((error) => {
        // Temporal can be ready before the worker has registered the workflow query.
        if (error instanceof HttpError && error.status === 503) return null;
        throw error;
      });
      if (!status) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      assert(!['failed', 'rejected'].includes(status.state), `Run stopped: ${status.error}`);
      if (predicate(status)) return status;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('Run did not reach expected state');
  }
  const initial = await waitFor((s) => s.state === 'awaiting-approval');
  assert(initial.contextDigest && initial.plan?.edits.length, 'Missing grounded plan');
  await request(`/runs/${runId}/decision`, {
    kind: 'request-changes',
    planRevision: 0,
    feedback: 'Mention negative numbers.',
  });
  const revised = await waitFor((s) => s.state === 'awaiting-approval' && s.revisions === 1);
  assert(
    revised.plan?.summary.includes('negative numbers'),
    'Revision feedback was not incorporated',
  );
  await request(`/runs/${runId}/decision`, { kind: 'approve', planRevision: 0 });
  assert.equal(
    (await request<RunStatus>(`/runs/${runId}`)).state,
    'awaiting-approval',
    'Stale approval was accepted',
  );
  await request(`/runs/${runId}/decision`, { kind: 'approve', planRevision: 1 });
  const completed = await waitFor((s) => s.state === 'completed');
  assert.equal(completed.testsPassed, true);
  assert(completed.prUrl?.startsWith('https://example.invalid/'), 'Expected simulated PR');
  console.log(
    JSON.stringify(
      {
        smoke: 'PASS',
        runId,
        state: completed.state,
        revisions: completed.revisions,
        testsPassed: completed.testsPassed,
        contextDigest: completed.contextDigest,
        prUrl: completed.prUrl,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

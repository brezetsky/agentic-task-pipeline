/**
 * Integration test of the durable approval flow, using Temporal's time-skipping
 * test environment with mock activities (no real I/O). Covers the approve path
 * and the request-changes -> revise -> approve path.
 */
import { resolve } from 'node:path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  Analysis,
  ImplementResult,
  Plan,
  PrResult,
  RunStatus,
  Task,
  TestResult,
} from '@pipeline/core/contracts';
import { taskPipeline } from './taskPipeline.js';
import { getStatus, submitDecision } from './signals.js';

const task: Task = { id: 'CARD-TEST', title: 'Add a thing', description: 'do the thing', source: 'mock' };

const activities = {
  async analyzeTask(): Promise<Analysis> {
    return { summary: 'analysis', affectedAreas: ['src/'], risks: [] };
  },
  async proposePlan({ feedback }: { feedback?: string }): Promise<Plan> {
    return {
      summary: feedback ? `revised: ${feedback}` : 'initial plan',
      steps: ['step 1'],
      edits: [{ path: 'CHANGES.md', action: 'create', contents: 'x' }],
      testCommand: 'npm test',
    };
  },
  async implementPlan(): Promise<ImplementResult> {
    return { branch: 'agent/test', filesChanged: ['CHANGES.md'] };
  },
  async runTests(): Promise<TestResult> {
    return { passed: true, summary: 'ok' };
  },
  async openPullRequest(): Promise<PrResult> {
    return { url: 'https://example.invalid/pull/1', simulated: true };
  },
  async reportResult(): Promise<void> {},
};

const workflowsPath = resolve(process.cwd(), 'packages/worker/src/workflows/index.ts');

async function waitUntil(getState: () => Promise<RunStatus>, pred: (s: RunStatus) => boolean): Promise<RunStatus> {
  for (let i = 0; i < 100; i++) {
    const s = await getState();
    if (pred(s)) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for run state');
}

describe('taskPipeline (durable human-in-the-loop)', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });
  afterAll(async () => {
    await env?.teardown();
  });

  function runWorker<T>(fn: () => Promise<T>): Promise<T> {
    return Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'test',
      workflowsPath,
      activities,
    }).then((worker) => worker.runUntil(fn));
  }

  it('pauses for approval and completes when approved', async () => {
    const result = await runWorker(async () => {
      const handle = await env.client.workflow.start(taskPipeline, {
        taskQueue: 'test',
        workflowId: 'wf-approve',
        args: [{ task, maxRevisions: 3 }],
      });
      await waitUntil(() => handle.query(getStatus), (s) => s.state === 'awaiting-approval');
      await handle.signal(submitDecision, { kind: 'approve' });
      return handle.result();
    });
    expect(result.outcome).toBe('completed');
    expect(result.prUrl).toBeTruthy();
    expect(result.testsPassed).toBe(true);
  });

  it('revises on request-changes, then completes on approval', async () => {
    const result = await runWorker(async () => {
      const handle = await env.client.workflow.start(taskPipeline, {
        taskQueue: 'test',
        workflowId: 'wf-revise',
        args: [{ task, maxRevisions: 3 }],
      });
      await waitUntil(() => handle.query(getStatus), (s) => s.state === 'awaiting-approval');
      await handle.signal(submitDecision, { kind: 'request-changes', feedback: 'use TS' });
      await waitUntil(
        () => handle.query(getStatus),
        (s) => s.revisions === 1 && s.state === 'awaiting-approval',
      );
      await handle.signal(submitDecision, { kind: 'approve' });
      return handle.result();
    });
    // The mid-flow waitUntil above already asserts revisions === 1 was reached.
    expect(result.outcome).toBe('completed');
  });
});

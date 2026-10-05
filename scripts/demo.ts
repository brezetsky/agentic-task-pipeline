import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import {
  GitWorkspace,
  loadConfig,
  runTestCommand,
  workspaceDir,
  validatePlan,
} from '@pipeline/core';
import type { Plan, RunStatus, RunResult } from '@pipeline/core';
import { getStatus, submitDecision } from '../packages/worker/src/workflows/signals.js';

/** Real Temporal + real local git/tests. Deterministic planner fixture; no model, board, or GitHub requests. */
async function main() {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), 'pipeline-demo-'));
  const workflowsPath = resolve('packages/worker/src/workflows/index.ts');
  await cp(resolve('sandbox'), join(root, 'sandbox'), { recursive: true });
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const cfg = loadConfig({}); // explicitly ignores ambient credentials
  const git = new GitWorkspace(cfg);
  process.chdir(root);
  let published = 0;
  try {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'demo',
      workflowsPath,
      activities: {
        prepareWorkspace: (id: string) => git.prepare(id),
        analyzeTask: async () => ({
          summary: 'Document addition or detect arithmetic regression',
          affectedAreas: ['src/sum.js'],
          risks: [],
        }),
        proposePlan: async ({ task }: { task: { id: string } }) =>
          validatePlan({
            summary: 'Deterministic demo fixture',
            steps: ['Apply reviewed edit', 'Run original tests'],
            testCommand: 'npm test',
            edits:
              task.id === 'good'
                ? [
                    {
                      path: 'CHANGES.md',
                      action: 'create',
                      contents: 'Documented addition behavior.',
                    },
                  ]
                : [
                    {
                      path: 'src/sum.js',
                      action: 'update',
                      contents: 'module.exports = { sum: () => 0 };',
                    },
                  ],
          }),
        implementPlan: ({ plan, runId }: { plan: Plan; runId: string }) =>
          git.implement({ plan, runId, branch: `agent/${runId}`, message: 'demo: approved edit' }),
        runTests: async ({ runId, testCommand }: { runId: string; testCommand: string }) => {
          const head = await git.head(runId);
          const result = await runTestCommand(workspaceDir(runId), testCommand, { mode: 'local' });
          if (result.passed) await git.recordTestSuccess(runId, head);
          return result;
        },
        openPullRequest: async ({ runId, branch }: { runId: string; branch: string }) => {
          await git.publish(runId, branch);
          published++;
          return { url: 'https://example.invalid/demo-pr', simulated: true };
        },
        reportResult: async () => {},
      },
    });
    await worker.runUntil(async () => {
      const results: RunResult[] = [];
      for (const id of ['good', 'bad']) {
        const handle = await env.client.workflow.start('taskPipeline', {
          taskQueue: 'demo',
          workflowId: `demo-${id}`,
          args: [
            {
              task: {
                id,
                title: 'Demonstrate validation gate',
                description: 'Synthetic offline fixture',
                source: 'demo',
              },
            },
          ],
        });
        let ready = false;
        for (let n = 0; n < 200; n++) {
          const status = await handle.query<RunStatus>('getStatus');
          if (status.state === 'awaiting-approval') {
            ready = true;
            break;
          }
          if (status.state === 'failed') throw new Error(status.error);
          await new Promise((r) => setTimeout(r, 50));
        }
        if (!ready) throw new Error('Approval checkpoint timed out');
        const status = await handle.query(getStatus);
        console.log(
          JSON.stringify({
            checkpoint: 'approval',
            runId: status.runId,
            contextDigest: status.contextDigest,
            edits: status.plan?.edits.map((e) => e.path),
          }),
        );
        await handle.signal(submitDecision, { kind: 'approve', planRevision: status.revisions });
        results.push((await handle.result()) as RunResult);
      }
      if (results[0].outcome !== 'completed' || results[1].outcome !== 'failed' || published !== 1)
        throw new Error('Demo invariants failed');
      console.log(
        JSON.stringify(
          {
            demo: 'PASS',
            realGit: true,
            realTests: true,
            simulatedPlannerAndPublication: true,
            published,
            results,
          },
          null,
          2,
        ),
      );
    });
  } finally {
    process.chdir(original);
    await env.teardown();
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

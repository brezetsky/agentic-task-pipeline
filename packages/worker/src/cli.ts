import { resolve } from 'node:path';
/**
 * Dev CLI to drive the pipeline before the HTTP API exists (Phase 3).
 * Usage (from repo root):
 *   npm run cli -w @pipeline/worker -- start [--auto]
 *   npm run cli -w @pipeline/worker -- status <workflowId>
 *   npm run cli -w @pipeline/worker -- approve <workflowId>
 *   npm run cli -w @pipeline/worker -- request-changes <workflowId> <feedback...>
 *   npm run cli -w @pipeline/worker -- result <workflowId>
 */
import { Client, Connection } from '@temporalio/client';
import { loadConfig, loadEnv } from '@pipeline/core';
import type { StartRunInput, Task } from '@pipeline/core/contracts';
import { taskPipeline } from './workflows/taskPipeline.js';
import { getStatus, submitDecision } from './workflows/signals.js';

function mockTask(): Task {
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    id: `T-${suffix}`,
    title: 'Add a CONTRIBUTING.md with local setup steps',
    description:
      'Create a CONTRIBUTING.md that explains how to install dependencies, run the app, and run the tests.',
    source: 'mock',
  };
}

async function main(): Promise<void> {
  process.chdir(resolve(__dirname, '../../..'));
  loadEnv();
  const cfg = loadConfig();
  const connection = await Connection.connect({ address: cfg.temporal.address });
  const client = new Client({ connection, namespace: cfg.temporal.namespace });
  const [cmd, ...rest] = process.argv.slice(2);

  try {
    switch (cmd) {
      case 'start': {
        if (
          rest.includes('--auto') &&
          (cfg.github.enabled || cfg.llm.enabled || cfg.board.enabled || cfg.targetRepo.path)
        )
          throw new Error('--auto is restricted to the bundled offline demo');
        const task = mockTask();
        const input: StartRunInput = {
          task,
          maxRevisions: cfg.maxRevisions,
          autoApprove: rest.includes('--auto'),
        };
        const handle = await client.workflow.start(taskPipeline, {
          taskQueue: cfg.temporal.taskQueue,
          workflowId: `run-${task.id}`,
          args: [input],
        });
        console.log(`Started run ${handle.workflowId} for task "${task.title}"`);
        console.log(
          `  status:          npm run cli -w @pipeline/worker -- status ${handle.workflowId}`,
        );
        console.log(
          `  approve:         npm run cli -w @pipeline/worker -- approve ${handle.workflowId}`,
        );
        console.log(
          `  request-changes: npm run cli -w @pipeline/worker -- request-changes ${handle.workflowId} "prefer TypeScript"`,
        );
        break;
      }
      case 'approve': {
        const id = rest[0];
        if (!id) throw new Error('usage: approve <workflowId>');
        await client.workflow.getHandle(id).signal(submitDecision, {
          kind: 'approve',
          planRevision: (await client.workflow.getHandle(id).query(getStatus)).revisions,
        });
        console.log(`Approved ${id}`);
        break;
      }
      case 'request-changes': {
        const id = rest[0];
        if (!id) throw new Error('usage: request-changes <workflowId> <feedback...>');
        const feedback = rest.slice(1).join(' ') || 'Please revise the plan.';
        await client.workflow.getHandle(id).signal(submitDecision, {
          kind: 'request-changes',
          feedback,
          planRevision: (await client.workflow.getHandle(id).query(getStatus)).revisions,
        });
        console.log(`Requested changes on ${id}: ${feedback}`);
        break;
      }
      case 'status': {
        const id = rest[0];
        if (!id) throw new Error('usage: status <workflowId>');
        const status = await client.workflow.getHandle(id).query(getStatus);
        console.log(JSON.stringify(status, null, 2));
        break;
      }
      case 'result': {
        const id = rest[0];
        if (!id) throw new Error('usage: result <workflowId>');
        const result = await client.workflow.getHandle(id).result();
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      default:
        console.log(
          'commands: start [--auto] | status <id> | approve <id> | request-changes <id> <feedback...> | result <id>',
        );
    }
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

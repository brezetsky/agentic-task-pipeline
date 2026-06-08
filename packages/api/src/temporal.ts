/**
 * Thin, lazily-connected Temporal client used by the API. Calls workflows by
 * shared NAME constants (no dependency on the worker package) and stays
 * type-safe via the contracts in @pipeline/core.
 */
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import {
  QUERY_GET_STATUS,
  SIGNAL_SUBMIT_DECISION,
  WORKFLOW_TYPE,
  type AppConfig,
  type Decision,
  type RunStatus,
  type StartRunInput,
  type Task,
  type TaskPipelineWorkflow,
} from '@pipeline/core';

let clientPromise: Promise<Client> | undefined;

async function connectWithRetry(address: string, attempts = 60): Promise<Connection> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await Connection.connect({ address });
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw lastErr;
}

/** Lazily connect so the API boots even while Temporal is starting. */
export async function getClient(cfg: AppConfig): Promise<Client> {
  if (!clientPromise) {
    clientPromise = connectWithRetry(cfg.temporal.address).then(
      (connection) => new Client({ connection, namespace: cfg.temporal.namespace }),
    );
  }
  return clientPromise;
}

export async function startRun(cfg: AppConfig, task: Task): Promise<string> {
  const client = await getClient(cfg);
  const workflowId = `run-${task.id}`;
  const input: StartRunInput = { task, maxRevisions: cfg.maxRevisions };
  try {
    const handle = await client.workflow.start<TaskPipelineWorkflow>(WORKFLOW_TYPE, {
      taskQueue: cfg.temporal.taskQueue,
      workflowId,
      args: [input],
    });
    return handle.workflowId;
  } catch (err) {
    // Idempotent start: a double-submit for the same card returns the same run.
    if (err instanceof WorkflowExecutionAlreadyStartedError) return workflowId;
    throw err;
  }
}

export async function getRunStatus(cfg: AppConfig, runId: string): Promise<RunStatus | null> {
  const client = await getClient(cfg);
  try {
    return await client.workflow.getHandle(runId).query<RunStatus>(QUERY_GET_STATUS);
  } catch {
    // Worker unavailable (e.g. the crash-resume window) or query not yet registered.
    return null;
  }
}

export async function sendDecision(cfg: AppConfig, runId: string, decision: Decision): Promise<void> {
  const client = await getClient(cfg);
  await client.workflow.getHandle(runId).signal(SIGNAL_SUBMIT_DECISION, decision);
}

export async function listRuns(cfg: AppConfig, limit = 50): Promise<RunStatus[]> {
  const client = await getClient(cfg);
  const out: RunStatus[] = [];
  try {
    for await (const wf of client.workflow.list({ query: `WorkflowType = '${WORKFLOW_TYPE}'` })) {
      const status = await getRunStatus(cfg, wf.workflowId);
      if (status) out.push(status);
      if (out.length >= limit) break;
    }
  } catch (err) {
    console.error('[api] listRuns failed', err);
  }
  return out;
}

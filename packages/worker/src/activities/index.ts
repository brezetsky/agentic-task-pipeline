/**
 * Activities = every side-effecting step, each delegating to an env-driven
 * provider in @pipeline/core (real when credentials are present, mock/simulated
 * otherwise). Activities run on the worker (normal Node); workflow code
 * references them by type only.
 */
import { Context } from '@temporalio/activity';
import {
  GitWorkspace,
  createBoardProvider,
  createLlmProvider,
  createPrProvider,
  loadConfig,
  runTestCommand,
  workspaceDir,
  validatePlan,
  PolicyError,
} from '@pipeline/core';
import type {
  Analysis,
  ImplementResult,
  Plan,
  PlanArgs,
  PrResult,
  Task,
  TestResult,
} from '@pipeline/core';

export async function analyzeTask(task: Task): Promise<Analysis> {
  return createLlmProvider(loadConfig()).analyze(task);
}

export async function proposePlan(args: PlanArgs): Promise<Plan> {
  return validatePlan(await createLlmProvider(loadConfig()).plan(args));
}

export async function prepareWorkspace(runId: string) {
  return new GitWorkspace(loadConfig()).prepare(runId);
}

export interface ImplementArgs {
  task: Task;
  plan: Plan;
  runId: string;
}
export async function implementPlan({
  task,
  plan,
  runId,
}: ImplementArgs): Promise<ImplementResult> {
  const cfg = loadConfig();
  const branch = `agent/${runId}`;
  const message = `agent: ${task.title}\n\n${plan.summary}`;
  return new GitWorkspace(cfg).implement({ runId, branch, plan, message });
}

export interface RunTestsArgs {
  runId: string;
  testCommand: string;
}
export async function runTests({ runId, testCommand }: RunTestsArgs): Promise<TestResult> {
  const ctx = Context.current();
  const cfg = loadConfig();
  if ((cfg.github.enabled || cfg.targetRepo.path) && !cfg.allowLocalExecution) {
    throw new PolicyError(
      'Custom repository execution requires ALLOW_LOCAL_EXECUTION=true on an isolated trusted host',
    );
  }
  const workspace = new GitWorkspace(cfg);
  const head = await workspace.head(runId);
  const heartbeat = setInterval(() => ctx.heartbeat('tests running'), 10_000);
  try {
    const result = await runTestCommand(workspaceDir(runId), testCommand, {
      signal: ctx.cancellationSignal,
    });
    if (result.passed) await workspace.recordTestSuccess(runId, head);
    return result;
  } finally {
    clearInterval(heartbeat);
  }
}

export interface OpenPrArgs {
  task: Task;
  plan: Plan;
  branch: string;
  runId: string;
}
export async function openPullRequest({
  task,
  plan,
  branch,
  runId,
}: OpenPrArgs): Promise<PrResult> {
  const cfg = loadConfig();
  await new GitWorkspace(cfg).publish(runId, branch);
  const body = [
    `### ${task.title}`,
    '',
    plan.summary,
    '',
    '**Plan**',
    ...plan.steps.map((s) => `- ${s}`),
    '',
    `_Opened by Agent Pipeline · run \`${runId}\`._`,
  ].join('\n');
  return createPrProvider(cfg).openPr({
    branch,
    base: cfg.github.baseBranch,
    title: `agent: ${task.title}`,
    body,
  });
}

export interface ReportArgs {
  task: Task;
  runId: string;
  prUrl?: string;
  branch?: string;
  testsPassed?: boolean;
}
export async function reportResult({
  task,
  runId,
  prUrl,
  branch,
  testsPassed,
}: ReportArgs): Promise<void> {
  const board = createBoardProvider(loadConfig());
  const text = `Agent Pipeline run ${runId}: ${prUrl ? `PR ${prUrl}` : 'no PR'}, tests ${
    testsPassed ? 'passed ✅' : 'failed ❌'
  }${branch ? `, branch ${branch}` : ''}.`;
  await board.comment(task.id, text).catch(() => undefined);
}

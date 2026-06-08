/**
 * Activities = every side-effecting step. Analyze + plan now delegate to the
 * env-driven LLM provider (real Gemini when GOOGLE_GENERATIVE_AI_API_KEY is set,
 * deterministic stub otherwise). Implement/test/PR/report remain stubs until
 * Phase 5. Activities run on the worker (normal Node); workflow code references
 * them by type only.
 */
import { createLlmProvider, loadConfig } from '@pipeline/core';
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
  return createLlmProvider(loadConfig()).plan(args);
}

export interface ImplementArgs {
  task: Task;
  plan: Plan;
  runId: string;
}
export async function implementPlan({ plan, runId }: ImplementArgs): Promise<ImplementResult> {
  // Phase 5 applies plan.edits to a real working copy. For now, simulate.
  return {
    branch: `agent/${runId}`,
    filesChanged: plan.edits.map((e) => e.path),
  };
}

export interface RunTestsArgs {
  runId: string;
  testCommand: string;
}
export async function runTests({ testCommand }: RunTestsArgs): Promise<TestResult> {
  // Phase 5 runs the real command in the working copy.
  return { passed: true, summary: `Ran "${testCommand}" — all tests passed (stub).` };
}

export interface OpenPrArgs {
  task: Task;
  plan: Plan;
  branch: string;
  runId: string;
}
export async function openPullRequest({ task, runId }: OpenPrArgs): Promise<PrResult> {
  // Phase 5 opens a real PR via the GitHub API when configured.
  return {
    url: `https://example.invalid/pull/${runId}`,
    title: task.title,
    simulated: true,
  };
}

export interface ReportArgs {
  task: Task;
  runId: string;
  prUrl?: string;
  branch?: string;
  testsPassed?: boolean;
}
export async function reportResult(args: ReportArgs): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `[report] run ${args.runId} "${args.task.title}": pr=${args.prUrl ?? 'n/a'} branch=${args.branch ?? 'n/a'} tests=${args.testsPassed}`,
  );
}

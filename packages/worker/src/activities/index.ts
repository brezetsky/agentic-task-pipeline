/**
 * Activities = every side-effecting step. Phase 1 ships deterministic STUBS so
 * the whole pipeline runs end-to-end; later phases swap the bodies for real
 * provider-backed implementations (LLM, git, test runner, GitHub) while keeping
 * these exact signatures. Activities run on the worker (normal Node) — workflow
 * code references them by type only.
 */
import type {
  Analysis,
  ImplementResult,
  Plan,
  PrResult,
  Task,
  TestResult,
} from '@pipeline/core/contracts';

export async function analyzeTask(task: Task): Promise<Analysis> {
  return {
    summary: `Reviewed "${task.title}". ${task.description}`.slice(0, 500),
    affectedAreas: ['src/'],
    risks: ['Stubbed analysis — no real code inspection yet.'],
  };
}

export interface ProposePlanArgs {
  task: Task;
  analysis: Analysis;
  feedback?: string;
}
export async function proposePlan({ task, feedback }: ProposePlanArgs): Promise<Plan> {
  const revisionNote = feedback ? ` Revised to address: ${feedback}` : '';
  return {
    summary: `Plan to implement "${task.title}".${revisionNote}`,
    steps: [
      'Inspect the affected area of the target repository',
      `Apply a focused change addressing: ${task.title}`,
      'Run the test suite and confirm green',
    ],
    edits: [
      {
        path: 'CHANGES.md',
        action: 'create',
        contents: `# ${task.title}\n\n${task.description}\n${feedback ? `\n> Revision: ${feedback}\n` : ''}`,
        rationale: 'Document the change (stub edit; real codegen arrives in Phase 2/5).',
      },
    ],
    testCommand: 'npm test',
  };
}

export interface ImplementArgs {
  task: Task;
  plan: Plan;
  runId: string;
}
export async function implementPlan({ plan, runId }: ImplementArgs): Promise<ImplementResult> {
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
  return { passed: true, summary: `Ran "${testCommand}" — all tests passed (stub).` };
}

export interface OpenPrArgs {
  task: Task;
  plan: Plan;
  branch: string;
  runId: string;
}
export async function openPullRequest({ task, runId }: OpenPrArgs): Promise<PrResult> {
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

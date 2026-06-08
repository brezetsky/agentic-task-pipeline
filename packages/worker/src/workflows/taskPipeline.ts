/**
 * The pipeline workflow. DETERMINISTIC: no direct I/O, no provider imports.
 * All side effects go through activities, which are referenced by TYPE ONLY
 * (`import type * as activities`) so the workflow bundler never pulls activity
 * I/O code (git/octokit/ai/fs) into the deterministic sandbox.
 *
 * Note: in the Temporal TS sandbox, `Date.now()`/`new Date()` are deterministic
 * (replaced by the SDK), so timestamping history here is replay-safe.
 */
import { condition, log, proxyActivities, setHandler, workflowInfo } from '@temporalio/workflow';
import type * as activities from '../activities/index.js';
import type {
  Analysis,
  Decision,
  HistoryEntry,
  Plan,
  RunResult,
  RunState,
  RunStatus,
  StartRunInput,
} from '@pipeline/core/contracts';
import { getStatus, submitDecision } from './signals.js';

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export async function taskPipeline(input: StartRunInput): Promise<RunResult> {
  const { task } = input;
  const runId = workflowInfo().workflowId;
  const maxRevisions = input.maxRevisions ?? 3;

  // --- queryable run state ---
  let state: RunState = 'pending';
  let analysis: Analysis | undefined;
  let plan: Plan | undefined;
  let decision: Decision | undefined;
  let revisions = 0;
  let lastFeedback: string | undefined;
  let branch: string | undefined;
  let prUrl: string | undefined;
  let testsPassed: boolean | undefined;
  let error: string | undefined;
  const history: HistoryEntry[] = [];

  const now = (): string => new Date().toISOString();
  const go = (next: RunState, note?: string): void => {
    state = next;
    history.push({ state: next, at: now(), ...(note ? { note } : {}) });
    log.info(`run ${runId} -> ${next}`, note ? { note } : {});
  };

  // Handlers MUST be registered before the first await so buffered signals and
  // early queries are handled correctly.
  setHandler(submitDecision, (d: Decision) => {
    if (state === 'awaiting-approval') {
      decision = { ...d, at: now() };
      log.info(`decision received: ${d.kind}`);
    } else {
      log.warn(`decision ignored (state=${state})`);
    }
  });
  setHandler(
    getStatus,
    (): RunStatus => ({
      runId,
      task,
      state,
      analysis,
      plan,
      revisions,
      lastFeedback,
      branch,
      prUrl,
      testsPassed,
      error,
      history,
    }),
  );

  try {
    go('analyzing');
    analysis = await acts.analyzeTask(task);

    go('planning');
    plan = await acts.proposePlan({ task, analysis });

    // --- approval + revise loop (the durable human-in-the-loop pause) ---
    for (;;) {
      go('awaiting-approval');
      decision = undefined;
      if (input.autoApprove && revisions === 0) {
        decision = { kind: 'approve', at: now() };
      }
      await condition(() => decision !== undefined);
      const d = decision as Decision;
      if (d.kind === 'approve') break;

      lastFeedback = d.feedback;
      revisions += 1;
      if (revisions > maxRevisions) {
        go('rejected', `exceeded ${maxRevisions} revision(s)`);
        return {
          runId,
          outcome: 'rejected',
          branch,
          testsPassed,
          summary: `Rejected: exceeded ${maxRevisions} revision(s).`,
        };
      }
      go('replanning', d.feedback);
      plan = await acts.proposePlan({ task, analysis, feedback: d.feedback });
    }

    const approvedPlan: Plan = plan;

    go('implementing');
    const impl = await acts.implementPlan({ task, plan: approvedPlan, runId });
    branch = impl.branch;

    go('testing');
    const test = await acts.runTests({ runId, testCommand: approvedPlan.testCommand });
    testsPassed = test.passed;
    if (!test.passed) {
      error = test.summary;
      go('failed', 'tests failed');
      return { runId, outcome: 'failed', branch, testsPassed, summary: `Tests failed: ${test.summary}` };
    }

    go('opening-pr');
    const pr = await acts.openPullRequest({ task, plan: approvedPlan, branch, runId });
    prUrl = pr.url;

    go('reporting');
    await acts.reportResult({ task, runId, prUrl, branch, testsPassed });

    go('completed');
    return { runId, outcome: 'completed', branch, prUrl, testsPassed, summary: `Opened PR: ${pr.url}` };
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    go('failed', error);
    return { runId, outcome: 'failed', branch, prUrl, testsPassed, summary: `Pipeline failed: ${error}` };
  }
}

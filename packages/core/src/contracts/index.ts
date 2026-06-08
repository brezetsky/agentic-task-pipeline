/**
 * Pure data contracts shared across every layer.
 *
 * IMPORTANT: this module is the ONLY part of @pipeline/core that Temporal
 * workflow code is allowed to import (via the deep path "@pipeline/core/contracts").
 * It MUST stay side-effect free: only `zod` schemas and inferred types, no
 * env reads, no Node built-ins, no provider/factory imports. Anything else would
 * be pulled into the deterministic workflow sandbox and break bundling.
 */
import { z } from 'zod';

/** Lifecycle states a run moves through. */
export const RunStateSchema = z.enum([
  'pending',
  'analyzing',
  'planning',
  'awaiting-approval',
  'replanning',
  'implementing',
  'testing',
  'opening-pr',
  'reporting',
  'completed',
  'failed',
  'rejected',
]);
export type RunState = z.infer<typeof RunStateSchema>;

/** A task pulled from the board (Trello card or mock). */
export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  source: z.string(),
  url: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

/** Output of the analyze step. */
export const AnalysisSchema = z.object({
  summary: z.string(),
  affectedAreas: z.array(z.string()),
  risks: z.array(z.string()),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

/** A single proposed file change. Full-file `contents` (not a diff) keeps
 *  application robust and LLM-friendly. */
export const FileEditSchema = z.object({
  path: z.string(),
  action: z.enum(['create', 'update', 'delete']),
  contents: z.string().optional(),
  rationale: z.string().optional(),
});
export type FileEdit = z.infer<typeof FileEditSchema>;

/** The plan a human approves or sends back. Kept intentionally flat so the
 *  LLM's structured-output (generateObject) is reliable across providers. */
export const PlanSchema = z.object({
  summary: z.string(),
  steps: z.array(z.string()),
  edits: z.array(FileEditSchema),
  testCommand: z.string(),
});
export type Plan = z.infer<typeof PlanSchema>;

/** A human decision delivered to the paused workflow via a signal. */
export const DecisionSchema = z.object({
  kind: z.enum(['approve', 'request-changes']),
  feedback: z.string().optional(),
  at: z.string().optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const HistoryEntrySchema = z.object({
  state: RunStateSchema,
  at: z.string(),
  note: z.string().optional(),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

/** Snapshot returned by the workflow `getStatus` query and surfaced over the API. */
export const RunStatusSchema = z.object({
  runId: z.string(),
  task: TaskSchema,
  state: RunStateSchema,
  analysis: AnalysisSchema.optional(),
  plan: PlanSchema.optional(),
  revisions: z.number(),
  lastFeedback: z.string().optional(),
  branch: z.string().optional(),
  prUrl: z.string().optional(),
  testsPassed: z.boolean().optional(),
  error: z.string().optional(),
  history: z.array(HistoryEntrySchema),
});
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** Result of the implement step. */
export const ImplementResultSchema = z.object({
  branch: z.string(),
  filesChanged: z.array(z.string()),
  commitSha: z.string().optional(),
});
export type ImplementResult = z.infer<typeof ImplementResultSchema>;

/** Result of the test step. */
export const TestResultSchema = z.object({
  passed: z.boolean(),
  summary: z.string(),
  output: z.string().optional(),
});
export type TestResult = z.infer<typeof TestResultSchema>;

/** Result of opening a pull request (real or simulated). */
export const PrResultSchema = z.object({
  url: z.string(),
  number: z.number().optional(),
  title: z.string().optional(),
  simulated: z.boolean(),
});
export type PrResult = z.infer<typeof PrResultSchema>;

/** Terminal result of a run. */
export const RunResultSchema = z.object({
  runId: z.string(),
  outcome: z.enum(['completed', 'rejected', 'failed']),
  branch: z.string().optional(),
  prUrl: z.string().optional(),
  testsPassed: z.boolean().optional(),
  summary: z.string(),
});
export type RunResult = z.infer<typeof RunResultSchema>;

/** Input used to start a pipeline run. */
export const StartRunInputSchema = z.object({
  task: TaskSchema,
  /** Max plan revisions before the run is auto-rejected (set from config). */
  maxRevisions: z.number().optional(),
  /** Demo/test convenience: auto-approve the first plan without a human. */
  autoApprove: z.boolean().optional(),
});
export type StartRunInput = z.infer<typeof StartRunInputSchema>;

// --- Temporal wiring names (shared so the API/CLI and worker never drift) ---
export const WORKFLOW_TYPE = 'taskPipeline';
export const SIGNAL_SUBMIT_DECISION = 'submitDecision';
export const QUERY_GET_STATUS = 'getStatus';

/** Signature of the pipeline workflow (for type-safe client calls by name). */
export type TaskPipelineWorkflow = (input: StartRunInput) => Promise<RunResult>;

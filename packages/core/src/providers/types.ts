/**
 * Provider interfaces — one per swappable integration. Each has a real and a
 * mock implementation; a factory (factory.ts / per-file `create*`) picks based
 * on env. Implementations live in @pipeline/core but are imported only by the
 * API and the worker's ACTIVITIES — never by workflow code.
 */
import type { Analysis, Plan, Task } from '../contracts/index.js';

export interface PlanArgs {
  task: Task;
  analysis: Analysis;
  feedback?: string;
}

/** Reasoning provider: analyze a task and propose an (editable) plan. */
export interface LlmProvider {
  readonly name: string;
  analyze(task: Task): Promise<Analysis>;
  plan(args: PlanArgs): Promise<Plan>;
}

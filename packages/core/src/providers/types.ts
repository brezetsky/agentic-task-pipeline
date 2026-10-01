/**
 * Provider interfaces — one per swappable integration. Each has a real and a
 * mock implementation; a factory (factory.ts / per-file `create*`) picks based
 * on env. Implementations live in @pipeline/core but are imported only by the
 * API and the worker's ACTIVITIES — never by workflow code.
 */
import type { RepositoryContext } from '../context.js';
import type { Analysis, Plan, PrResult, Task } from '../contracts/index.js';

export interface PlanArgs {
  task: Task;
  analysis: Analysis;
  feedback?: string;
  context?: RepositoryContext;
}

/** Reasoning provider: analyze a task and propose an (editable) plan. */
export interface LlmProvider {
  readonly name: string;
  analyze(task: Task): Promise<Analysis>;
  plan(args: PlanArgs): Promise<Plan>;
}

/** Task board (Trello or mock) — the inbound source of work. */
export interface BoardProvider {
  readonly name: string;
  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  /** Post a status comment back to the board card (best-effort). */
  comment(taskId: string, text: string): Promise<void>;
}

export interface OpenPrArgs {
  branch: string;
  base: string;
  title: string;
  body: string;
}

/** Opens (or finds) a pull request for a pushed branch. */
export interface PrProvider {
  readonly name: string;
  openPr(args: OpenPrArgs): Promise<PrResult>;
}

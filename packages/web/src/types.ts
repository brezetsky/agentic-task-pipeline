// View models mirroring the API's JSON (kept local so the SPA has no build-time
// coupling to the backend packages).
export type RunState =
  | 'pending'
  | 'analyzing'
  | 'planning'
  | 'awaiting-approval'
  | 'replanning'
  | 'implementing'
  | 'testing'
  | 'opening-pr'
  | 'reporting'
  | 'completed'
  | 'failed'
  | 'rejected';

export interface Task {
  id: string;
  title: string;
  description: string;
  source: string;
  url?: string;
}

export interface Analysis {
  summary: string;
  affectedAreas: string[];
  risks: string[];
}

export interface FileEdit {
  path: string;
  action: 'create' | 'update' | 'delete';
  contents?: string;
  rationale?: string;
}

export interface Plan {
  summary: string;
  steps: string[];
  edits: FileEdit[];
  testCommand: string;
}

export interface HistoryEntry {
  state: RunState;
  at: string;
  note?: string;
}

export interface RunStatus {
  runId: string;
  task: Task;
  state: RunState;
  analysis?: Analysis;
  plan?: Plan;
  revisions: number;
  lastFeedback?: string;
  branch?: string;
  prUrl?: string;
  testsPassed?: boolean;
  error?: string;
  history: HistoryEntry[];
}

export interface Info {
  mode: 'mock' | 'live';
  integrations: { llm: string; board: string; github: string };
  maxRevisions: number;
}

export const TERMINAL: RunState[] = ['completed', 'failed', 'rejected'];

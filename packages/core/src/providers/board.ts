/**
 * Board provider. Phase 3 ships a mock with sample tasks so the queue/API are
 * real with zero setup; Phase 6 adds the Trello-backed implementation and wires
 * it into `createBoardProvider` when TRELLO_* env vars are present.
 */
import type { AppConfig } from '../config.js';
import { TaskSchema } from '../contracts/index.js';
import type { Task } from '../contracts/index.js';
import type { BoardProvider } from './types.js';

const SAMPLE_TASKS: Task[] = [
  {
    id: 'CARD-101',
    title: 'Add a /health endpoint to the service',
    description:
      'Expose GET /health returning {"status":"ok"} so load balancers can run liveness checks.',
    source: 'mock',
  },
  {
    id: 'CARD-102',
    title: 'Add a CONTRIBUTING.md with local setup steps',
    description: 'Document how to install dependencies, run the app, and run the test suite.',
    source: 'mock',
  },
  {
    id: 'CARD-103',
    title: 'Validate input on the create-item endpoint',
    description: 'Reject empty titles and trim surrounding whitespace before persisting.',
    source: 'mock',
  },
];

export class MockBoardProvider implements BoardProvider {
  readonly name = 'mock';

  async listTasks(): Promise<Task[]> {
    return SAMPLE_TASKS;
  }

  async getTask(id: string): Promise<Task | null> {
    return SAMPLE_TASKS.find((t) => t.id === id) ?? null;
  }

  async comment(taskId: string, text: string): Promise<void> {
    console.log(`[board:mock] comment on ${taskId}: ${text}`);
  }
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  shortUrl?: string;
  url?: string;
}

/** Trello-backed board. Auth is via key+token query params (Trello's REST style). */
export class TrelloBoardProvider implements BoardProvider {
  readonly name = 'trello';
  constructor(private readonly cfg: AppConfig['board']) {}

  private auth(): string {
    return new URLSearchParams({ key: this.cfg.apiKey!, token: this.cfg.token! }).toString();
  }

  private toTask(c: TrelloCard): Task {
    return TaskSchema.parse({
      id: c.id,
      title: c.name,
      description: c.desc && c.desc.trim() ? c.desc : c.name,
      source: 'trello',
      url: c.shortUrl ?? c.url,
    });
  }

  async listTasks(): Promise<Task[]> {
    const res = await fetch(
      `https://api.trello.com/1/lists/${encodeURIComponent(this.cfg.listId!)}/cards?${this.auth()}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) throw new Error(`Trello list cards failed (${res.status})`);
    const cards = (await res.json()) as TrelloCard[];
    return cards.map((c) => this.toTask(c));
  }

  async getTask(id: string): Promise<Task | null> {
    const res = await fetch(
      `https://api.trello.com/1/cards/${encodeURIComponent(id)}?${this.auth()}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    return this.toTask((await res.json()) as TrelloCard);
  }

  async comment(taskId: string, text: string): Promise<void> {
    await fetch(
      `https://api.trello.com/1/cards/${encodeURIComponent(taskId)}/actions/comments?${this.auth()}&text=${encodeURIComponent(text)}`,
      { method: 'POST', signal: AbortSignal.timeout(15_000) },
    ).catch(() => undefined);
  }
}

export function createBoardProvider(cfg: AppConfig): BoardProvider {
  return cfg.board.enabled ? new TrelloBoardProvider(cfg.board) : new MockBoardProvider();
}

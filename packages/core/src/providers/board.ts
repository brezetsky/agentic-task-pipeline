/**
 * Board provider. Phase 3 ships a mock with sample tasks so the queue/API are
 * real with zero setup; Phase 6 adds the Trello-backed implementation and wires
 * it into `createBoardProvider` when TRELLO_* env vars are present.
 */
import type { AppConfig } from '../config.js';
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
    // eslint-disable-next-line no-console
    console.log(`[board:mock] comment on ${taskId}: ${text}`);
  }
}

export function createBoardProvider(_cfg: AppConfig): BoardProvider {
  // Phase 6 returns a TrelloBoardProvider when _cfg.board.enabled.
  return new MockBoardProvider();
}

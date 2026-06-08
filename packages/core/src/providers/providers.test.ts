import { describe, expect, it } from 'vitest';
import {
  MockBoardProvider,
  StubLlmProvider,
  createBoardProvider,
  createLlmProvider,
  createPrProvider,
  loadConfig,
} from '../index.js';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('provider factories', () => {
  it('select mock/stub providers when no credentials are configured', () => {
    const cfg = loadConfig(env({}));
    expect(createLlmProvider(cfg).name).toBe('stub');
    expect(createBoardProvider(cfg).name).toBe('mock');
    expect(createPrProvider(cfg).name).toBe('mock');
  });

  it('select real providers when credentials are present', () => {
    const cfg = loadConfig(
      env({
        GOOGLE_GENERATIVE_AI_API_KEY: 'x',
        TRELLO_API_KEY: 'k',
        TRELLO_TOKEN: 't',
        TRELLO_LIST_ID: 'l',
        GITHUB_TOKEN: 't',
        GITHUB_OWNER: 'o',
        GITHUB_REPO: 'r',
      }),
    );
    expect(createLlmProvider(cfg).name).toBe('gemini');
    expect(createBoardProvider(cfg).name).toBe('trello');
    expect(createPrProvider(cfg).name).toBe('github');
  });
});

describe('mock implementations', () => {
  it('StubLlmProvider proposes a plan with edits and a test command', async () => {
    const plan = await new StubLlmProvider().plan({
      task: { id: '1', title: 'T', description: 'D', source: 'mock' },
      analysis: { summary: 's', affectedAreas: [], risks: [] },
    });
    expect(plan.edits.length).toBeGreaterThan(0);
    expect(plan.testCommand).toBeTruthy();
  });

  it('StubLlmProvider reflects feedback in a revised plan', async () => {
    const plan = await new StubLlmProvider().plan({
      task: { id: '1', title: 'T', description: 'D', source: 'mock' },
      analysis: { summary: 's', affectedAreas: [], risks: [] },
      feedback: 'use TypeScript',
    });
    expect(plan.summary).toContain('use TypeScript');
  });

  it('MockBoardProvider lists and fetches tasks', async () => {
    const board = new MockBoardProvider();
    const tasks = await board.listTasks();
    expect(tasks.length).toBeGreaterThan(0);
    const fetched = await board.getTask(tasks[0].id);
    expect(fetched?.id).toBe(tasks[0].id);
    expect(await board.getTask('nope')).toBeNull();
  });
});

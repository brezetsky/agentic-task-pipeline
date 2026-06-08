import { describe, expect, it } from 'vitest';
import { loadConfig } from './index.js';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('loadConfig (graceful degradation)', () => {
  it('defaults to mock mode with no environment', () => {
    const cfg = loadConfig(env({}));
    expect(cfg.llm.enabled).toBe(false);
    expect(cfg.board.enabled).toBe(false);
    expect(cfg.github.enabled).toBe(false);
    expect(cfg.temporal.taskQueue).toBe('agent-pipeline');
    expect(cfg.maxRevisions).toBe(3);
  });

  it('enables the LLM when an API key is present', () => {
    expect(loadConfig(env({ GOOGLE_GENERATIVE_AI_API_KEY: 'x' })).llm.enabled).toBe(true);
  });

  it('enables GitHub only when token, owner and repo are all set', () => {
    expect(loadConfig(env({ GITHUB_TOKEN: 't', GITHUB_OWNER: 'o' })).github.enabled).toBe(false);
    expect(loadConfig(env({ GITHUB_TOKEN: 't', GITHUB_OWNER: 'o', GITHUB_REPO: 'r' })).github.enabled).toBe(true);
  });

  it('enables the board only when key, token and list are all set', () => {
    expect(loadConfig(env({ TRELLO_API_KEY: 'k', TRELLO_TOKEN: 't' })).board.enabled).toBe(false);
    expect(
      loadConfig(env({ TRELLO_API_KEY: 'k', TRELLO_TOKEN: 't', TRELLO_LIST_ID: 'l' })).board.enabled,
    ).toBe(true);
  });
});

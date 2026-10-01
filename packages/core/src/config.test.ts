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
    expect(
      loadConfig(env({ LLM_MODEL: 'test-model', GOOGLE_GENERATIVE_AI_API_KEY: 'x' })).llm.enabled,
    ).toBe(true);
  });

  it('enables GitHub only when token, owner and repo are all set', () => {
    expect(loadConfig(env({ GITHUB_TOKEN: 't', GITHUB_OWNER: 'o' })).github.enabled).toBe(false);
    expect(
      loadConfig(env({ GITHUB_TOKEN: 't', GITHUB_OWNER: 'o', GITHUB_REPO: 'r' })).github.enabled,
    ).toBe(true);
  });

  it('enables the board only when key, token and list are all set', () => {
    expect(loadConfig(env({ TRELLO_API_KEY: 'k', TRELLO_TOKEN: 't' })).board.enabled).toBe(false);
    expect(
      loadConfig(env({ TRELLO_API_KEY: 'k', TRELLO_TOKEN: 't', TRELLO_LIST_ID: 'l' })).board
        .enabled,
    ).toBe(true);
  });
});

it.each([
  { API_PORT: 'NaN' },
  { API_PORT: '0' },
  { MAX_REVISIONS: '-1' },
  { MAX_REVISIONS: '100' },
])('rejects invalid numeric configuration %o', (invalid) => {
  expect(() => loadConfig(invalid)).toThrow();
});
it('requires production auth unless explicitly in local-demo mode', () => {
  expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('requires');
  expect(() =>
    loadConfig({ NODE_ENV: 'production', API_AUTH_TOKEN: 'x'.repeat(32) }),
  ).not.toThrow();
  expect(() =>
    loadConfig({ NODE_ENV: 'production', API_ALLOW_UNAUTHENTICATED: 'true' }),
  ).not.toThrow();
  expect(() => loadConfig({ API_AUTH_TOKEN: 'short' })).toThrow();
});
it('requires an explicit live model and rejects unsupported clone URLs', () => {
  expect(() => loadConfig({ GOOGLE_GENERATIVE_AI_API_KEY: 'x' })).toThrow('LLM_MODEL');
  expect(() => loadConfig({ TARGET_REPO_URL: 'https://example.com/repo' })).toThrow('unsupported');
});

/**
 * Runtime configuration, derived from environment variables.
 *
 * `loadConfig` reads `process.env` lazily (inside the function, never at module
 * load) so importing this file has no side effects. It is called from the API
 * and the worker's ACTIVITIES — never from workflow code, which must stay
 * deterministic and env-agnostic.
 *
 * The `enabled` flags implement graceful degradation: a real integration turns
 * on only when all of its required vars are present; otherwise the mock is used.
 */
import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface AppConfig {
  temporal: { address: string; namespace: string; taskQueue: string };
  api: { port: number };
  web: { port: number };
  llm: { apiKey?: string; model: string; enabled: boolean };
  board: { apiKey?: string; token?: string; listId?: string; enabled: boolean };
  github: {
    token?: string;
    owner?: string;
    repo?: string;
    baseBranch: string;
    enabled: boolean;
  };
  targetRepo: { path?: string; url?: string };
  maxRevisions: number;
}

function bool(...vals: (string | undefined)[]): boolean {
  return vals.every((v) => typeof v === 'string' && v.trim().length > 0);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const llmKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  const trelloKey = env.TRELLO_API_KEY;
  const trelloToken = env.TRELLO_TOKEN;
  const trelloList = env.TRELLO_LIST_ID;
  const ghToken = env.GITHUB_TOKEN;
  const ghOwner = env.GITHUB_OWNER;
  const ghRepo = env.GITHUB_REPO;

  return {
    temporal: {
      address: env.TEMPORAL_ADDRESS ?? 'localhost:7233',
      namespace: env.TEMPORAL_NAMESPACE ?? 'default',
      taskQueue: env.TEMPORAL_TASK_QUEUE ?? 'agent-pipeline',
    },
    api: { port: Number(env.API_PORT ?? 3001) },
    web: { port: Number(env.WEB_PORT ?? 5173) },
    llm: {
      apiKey: llmKey,
      model: env.LLM_MODEL ?? 'gemini-2.0-flash',
      enabled: bool(llmKey),
    },
    board: {
      apiKey: trelloKey,
      token: trelloToken,
      listId: trelloList,
      enabled: bool(trelloKey, trelloToken, trelloList),
    },
    github: {
      token: ghToken,
      owner: ghOwner,
      repo: ghRepo,
      baseBranch: env.GITHUB_BASE_BRANCH ?? 'main',
      enabled: bool(ghToken, ghOwner, ghRepo),
    },
    targetRepo: { path: env.TARGET_REPO_PATH, url: env.TARGET_REPO_URL },
    maxRevisions: Number(env.MAX_REVISIONS ?? 3),
  };
}

/**
 * Load environment variables from the nearest `.env`, walking up from `startDir`
 * (the repo root holds the single `.env`). No-op when none exists. Call from
 * entrypoints (api/worker/cli) only — never from workflow code.
 */
export function loadEnv(startDir: string = process.cwd()): void {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      dotenvConfig({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenvConfig();
}

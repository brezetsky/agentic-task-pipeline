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
import { z } from 'zod';
import { dirname, resolve } from 'node:path';

export const ApiPrincipalSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    tokenSha256: z.string().regex(/^[a-f0-9]{64}$/),
    roles: z.array(z.enum(['viewer', 'operator', 'reviewer'])).min(1),
  })
  .strict();
export type ApiPrincipal = z.infer<typeof ApiPrincipalSchema>;

export interface AppConfig {
  temporal: { address: string; namespace: string; taskQueue: string };
  api: { port: number; host: string; token?: string; principals: ApiPrincipal[] };
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
  targetRepo: { path?: string };
  maxRevisions: number;
  allowLocalExecution: boolean;
  execution: { mode: 'docker' | 'local'; image: string };
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

  const port = (value: string | undefined, fallback: number) =>
    z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(value || fallback);
  const optional = (value: string | undefined) => value?.trim() || undefined;
  const token = optional(env.API_AUTH_TOKEN);
  if (bool(llmKey) && !optional(env.LLM_MODEL))
    throw new Error('Set LLM_MODEL explicitly when enabling Gemini');
  if (token && token.length < 32)
    throw new Error('API_AUTH_TOKEN must have at least 32 characters');
  let principals: ApiPrincipal[] = [];
  if (env.API_PRINCIPALS) {
    try {
      principals = z
        .array(ApiPrincipalSchema)
        .min(1)
        .max(100)
        .parse(JSON.parse(env.API_PRINCIPALS));
    } catch {
      throw new Error('API_PRINCIPALS must be a JSON array of id, tokenSha256 and roles');
    }
    if (
      new Set(principals.map((p) => p.id)).size !== principals.length ||
      new Set(principals.map((p) => p.tokenSha256)).size !== principals.length
    )
      throw new Error('API_PRINCIPALS identities and token hashes must be unique');
    if (token) throw new Error('Use API_PRINCIPALS or API_AUTH_TOKEN, not both');
  }
  if (
    env.NODE_ENV === 'production' &&
    env.API_ALLOW_UNAUTHENTICATED !== 'true' &&
    !token &&
    !principals.length
  ) {
    throw new Error('Production API requires API_PRINCIPALS or API_AUTH_TOKEN');
  }
  if (ghOwner)
    z.string()
      .regex(/^[a-zA-Z0-9-]+$/)
      .parse(ghOwner);
  if (ghRepo)
    z.string()
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .parse(ghRepo);
  if (env.TARGET_REPO_URL)
    throw new Error('TARGET_REPO_URL is unsupported; configure GitHub or TARGET_REPO_PATH');
  return {
    temporal: {
      address: env.TEMPORAL_ADDRESS ?? 'localhost:7233',
      namespace: env.TEMPORAL_NAMESPACE ?? 'default',
      taskQueue: env.TEMPORAL_TASK_QUEUE ?? 'agent-pipeline',
    },
    api: { port: port(env.API_PORT, 3001), host: env.API_HOST || '127.0.0.1', token, principals },
    web: { port: port(env.WEB_PORT, 5173) },
    llm: {
      apiKey: llmKey,
      model: optional(env.LLM_MODEL) ?? 'unconfigured',
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
    targetRepo: { path: optional(env.TARGET_REPO_PATH) },
    maxRevisions: z.coerce
      .number()
      .int()
      .min(0)
      .max(10)
      .parse(env.MAX_REVISIONS || 3),
    allowLocalExecution: env.ALLOW_LOCAL_EXECUTION === 'true',
    execution: {
      mode: z.enum(['docker', 'local']).parse(env.EXECUTION_MODE || 'docker'),
      image: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,250}$/)
        .parse(env.TEST_RUNNER_IMAGE || 'node:22-slim'),
    },
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

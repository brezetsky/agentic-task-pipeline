# Architecture

## The layers

| Layer | Choice | Why |
| --- | --- | --- |
| **Orchestration** | Temporal (TS SDK) | Durable workflows that pause arbitrarily long for human approval and survive process crashes; signals/queries map directly onto human-in-the-loop. |
| **Backend** | Express + SSE | Boring and reviewable. Status is one-directional (server→UI) so SSE fits; decisions go back via plain `POST`. |
| **Reasoning** | Vercel AI SDK (`ai`) + `@ai-sdk/google` (Gemini) | Brief-mandated (not LangChain); `generateObject` gives schema-validated plans. Gemini has a free tier. |
| **Board** | Trello REST behind a `BoardProvider` interface | Simplest free board API; the interface keeps the source swappable. |
| **Execution** | `simple-git` + `node:child_process` + GitHub REST (`fetch`) | Real branch/commit/push, a real test run, a real PR — each with a mock twin. |
| **UI** | React + Vite | Clean SPA; the API serves the build in production (same origin, no CORS). |
| **Infra** | docker-compose + Terraform (AWS) | One-command local stack; real, reviewable cloud IaC (unapplied). |

Packages (npm workspaces): `core` (contracts + providers + config), `worker`
(Temporal workflows + activities), `api` (Express), `web` (React).

## Request flow

```
Board ──listTasks──▶ API ──start workflow──▶ Temporal ──schedules──▶ Worker
                      ▲                          │                      │
            POST /decision (signal)              │ activities           │ analyze/plan (LLM)
                      │                           ▼                      ▼
   UI ◀── SSE (getStatus query) ── API      condition() pause ◀── awaiting human ── implement/test/PR
```

The API holds a Temporal **client**; the worker hosts the **workflow + activities**.
They share nothing but a few **name constants** in `core/contracts` (`WORKFLOW_TYPE`,
the signal/query names), so the API never imports worker code.

## Key decisions

### 1. The determinism boundary (the load-bearing rule)
Workflow code (`packages/worker/src/workflows/`) is deterministic: no network, no
filesystem, no env reads — only activity calls, `condition()`/`sleep()`, and
signal/query state. All side effects live in **activities**, which call the
provider layer.

- Workflows reference activities by **type only**:
  `import type * as activities` + `proxyActivities<typeof activities>(...)`. A value
  import would drag `simple-git`/`ai`/`fs` into the deterministic V8 sandbox and
  break bundling. (Verified: the workflow bundle contains only the workflow files
  + `@temporalio/*`, no activity/provider code.)
- Shared zod schemas live in a **side-effect-free leaf**, `@pipeline/core/contracts`.
  Workflows import that subpath, never the package barrel (which reaches the
  env-reading provider factory).
- `Date.now()`/`Math.random()` are deterministic *inside* Temporal TS workflows
  (the SDK overrides them), so timestamping history on the workflow side is safe.

### 2. Graceful degradation via an env-driven provider factory
`core/providers` defines one interface per integration — `LlmProvider`,
`BoardProvider`, `PrProvider` (+ a `GitWorkspace` and a test runner) — each with a
real and a mock implementation. `create*Provider(config)` picks based on whether
the relevant env vars are present. The factory reads `process.env` only in
API/activity context, never in workflows. No credentials ⇒ every provider is the
mock ⇒ the pipeline runs end-to-end on stubs.

### 3. Durable human-in-the-loop
The workflow registers a `submitDecision` signal and a `getStatus` query
**synchronously at the top** (so buffered signals/early queries are handled), then
`await condition(() => decision !== undefined)`. The revise loop is a bounded
`while`: plan → wait → on `request-changes` reset the decision and re-plan with the
feedback; on `approve` break; a `MAX_REVISIONS` guard prevents unbounded history.
Decisions are accepted only while `state === 'awaiting-approval'`, so a stray or
duplicate signal mid-replan is ignored. The `workflowId` is deterministic
(`run-<taskId>`), so a double-submit collides instead of forking a second run.

**Crash-resume** works because the durable state (history + the pending signal)
lives in the Temporal service + Postgres. The worker is a stateless, replaceable
execution host: kill it at the approval pause, deliver the decision (recorded by
the Temporal frontend with no worker running), restart the worker, and it replays
history and continues.

### 4. Idempotent, retry-safe side effects
Temporal retries activities, so each is designed for at-least-once:
- Deterministic branch `agent/<runId>`; the git activity starts from a clean
  working copy so retries don't stack edits.
- PR creation is **list-first** (return the existing PR if present) and treats
  GitHub's `422 already exists` as success; a non-`422` 4xx becomes a
  **non-retryable** `PrError` (the workflow lists it in `nonRetryableErrorTypes`)
  so a bad token fails fast instead of hammering the API.
- The test activity **heartbeats** its output and wires an `AbortSignal` to
  Temporal cancellation, under a separate proxy group with a `heartbeatTimeout`.

### 5. Plan-carries-the-edits
The LLM proposes the actual file edits *as part of the plan*. The human approves
the real diff; "implement" just applies it. This avoids a second, divergent
code-gen call on retry and makes the approval meaningful.

### 6. Toolchain choices forced by reality
The dev machine's default `node` is ancient and breaks corepack, so the repo uses
**Node 22 + npm workspaces** (no pnpm/corepack), `module/moduleResolution:
NodeNext`, CommonJS. `@octokit/rest` is now ESM-only, so GitHub uses the built-in
`fetch` (dependency-light, no ESM/CJS friction); the test runner uses
`node:child_process` rather than ESM-only `execa`.

## Trade-offs / out of scope

- Single-user, local-first: no auth, multi-tenancy, billing, or production secrets
  management. The Terraform is written for review, not applied.
- Activities share a local `.work/<runId>` directory across the implement and test
  steps, which assumes one worker host (fine for local-first; a shared volume or a
  single combined activity would generalize it).
- One board provider (Trello) behind the interface — additional providers are out
  of scope but the seam exists.

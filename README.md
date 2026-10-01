# Agent Pipeline

A production-oriented reference implementation of a **durable coding-agent harness**: prepare repository context → analyze → propose exact edits → human approval → implement → test → draft PR.

[![Quality gates](https://github.com/brezetsky/agentic-task-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/brezetsky/agentic-task-pipeline/actions/workflows/ci.yml)

The interesting part is the engineering around the model: permissions enforced in code, durable approval tied to a plan revision, bounded context and execution, repeatable validation, and publication only after a clean test pass. Temporal orchestrates the workflow; TypeScript, Express, React, Gemini via AI SDK, and GitHub/Trello adapters provide the implementation.

**Status:** suitable for a reproducible portfolio demonstration and trusted, single-worker deployments. This is not a hostile-code sandbox or a multi-tenant service. See [security boundaries](SECURITY.md) and [deployment limits](docs/OPERATIONS.md).

## Try it without credentials

Node **22.14+ or 24**, npm, Git, and a POSIX host (Linux/macOS):

```bash
npm ci
npm run check
npm run demo
```

The demo starts an ephemeral Temporal test server, runs real Git commits and real tests, pauses at the approval checkpoint, and drives two deterministic planner fixtures: a valid change that reaches simulated publication and a broken implementation that is blocked by the original tests. It uses a temporary directory, ignores ambient credentials, and cleans up. The first run downloads Temporal's test binary. No LLM or GitHub calls occur.

To explore the UI:

```bash
docker compose up --build
```

Open [the app](http://localhost:3001) and [Temporal UI](http://localhost:8080). Compose binds published ports to loopback and preserves Temporal data and worker workspaces in named volumes. Alternatively, with the Temporal CLI installed, run `make dev` from the repository root.

**Interview:** follow the [10-minute walkthrough](docs/INTERVIEW.md), which maps implemented evidence to the target role and explains tradeoffs.

## What is implemented

| Capability            | Evidence                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable orchestration | Temporal activities, bounded retries/revisions, restart-and-replay integration test                                                                      |
| Human control         | Exact file contents reviewed before execution; decisions identify the plan revision; stale decisions ignored                                             |
| Grounded planning     | Bounded repository corpus, lexical retrieval, file hashes, immutable per-run base snapshot                                                               |
| Execution policy      | Restricted paths, symlink checks, edit/output budgets, fixed test commands, filtered process environment, timeout and cancellation                       |
| Publication gate      | No push during implementation; clean tested commit required before normal push and draft PR creation                                                     |
| MCP                   | Real stdio server with search, file reads, deterministic plan review, policy resource, and review prompt; SDK client integration test                    |
| Reusable skills       | [Pipeline change](.agents/skills/pipeline-change/SKILL.md) and [pipeline debugging](.agents/skills/pipeline-debug/SKILL.md), plus [AGENTS.md](AGENTS.md) |
| Automated feedback    | Typechecking including tests/scripts, ESLint determinism boundary, unit/integration tests, retrieval/policy regression evaluation, offline demo, CI      |
| Operations            | API bearer authentication, validation, liveness/readiness, request IDs and metadata logs, non-root containers, dependency updates                        |

## MCP and skills

```bash
npm run build
MCP_REPO_ROOT=/absolute/path/to/target node packages/mcp/dist/server.js
```

Configure an MCP client with a direct Node command (avoids npm output on the JSON-RPC channel):

```json
{
  "mcpServers": {
    "agent-pipeline": {
      "command": "node",
      "args": ["/absolute/path/to/agentic-task-pipeline/packages/mcp/dist/server.js"],
      "env": { "MCP_REPO_ROOT": "/absolute/path/to/target" }
    }
  }
}
```

Tools: `search_repository`, `read_context_file`, `review_plan`. Resource: `pipeline://policy`. Prompt: `review-task`. All capabilities are read-only; there is no approval, execution, or publication tool. The operator fixes the repository root at startup. The server never loads `.env`.

The runtime planner uses the same context/policy modules directly; it does not add a redundant MCP subprocess hop. MCP makes those capabilities reusable from an external coding agent. Skills are repository-local instruction workflows for the coding agent; they are not executable permission grants or a replacement for runtime policy.

## Configuration and live integrations

Copy `.env.example` to `.env`. Entry points load it; workflows never read environment variables.

| Variable                                                            | Purpose                                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_GENERATIVE_AI_API_KEY`, `LLM_MODEL`                         | Enable Gemini structured planning; select a model available in your account                                           |
| `TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_LIST_ID`                  | Enable the real task board when all are present                                                                       |
| `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BASE_BRANCH` | Clone a configured GitHub base and publish a tested branch/draft PR                                                   |
| `TARGET_REPO_PATH`                                                  | Trusted local source instead of the bundled sandbox; run commands from repository root                                |
| `ALLOW_LOCAL_EXECUTION=true`                                        | Required to execute tests from a custom/live repository; provision an isolated host first                             |
| `API_AUTH_TOKEN`                                                    | Bearer token of at least 32 characters; required with `NODE_ENV=production` unless explicitly bypassed for local demo |
| `API_HOST`, `API_PORT`                                              | Defaults to `127.0.0.1:3001`; containers listen on `0.0.0.0` internally                                               |
| `MAX_REVISIONS`                                                     | Integer 0–10; default 3                                                                                               |
| `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`     | Temporal connection/routing                                                                                           |

Partial integration credentials select the mock for that integration; inspect `/api/info` before a live run. Remote URL input is deliberately unsupported. No dependency installation is performed inside a target: it must be testable using its trusted base and the configured execution image. The bundled target uses Node's built-in test runner.

When auth is enabled, enter the token in the UI's connection form (tab-scoped session storage), or send `Authorization: Bearer ...`. Authenticated UI updates use polling because native EventSource cannot send bearer headers. Use HTTPS and a gateway for remote access; never put tokens in URLs.

```bash
curl localhost:3001/api/board/tasks
curl -X POST localhost:3001/api/runs -H 'content-type: application/json' \
  -d '{"taskId":"CARD-101"}'
curl localhost:3001/api/runs/run-CARD-101
# Read revisions from the status, then approve that exact revision:
curl -X POST localhost:3001/api/runs/run-CARD-101/decision \
  -H 'content-type: application/json' -d '{"kind":"approve","planRevision":0}'
```

An existing task ID returns the same run ID; closed IDs are not reused. Use a new task ID for a new run. The API does not accept auto-approval. The CLI's `--auto` is restricted to the bundled offline configuration.

## Layout and further reading

- `packages/core`: contracts, policy, retrieval, configuration, provider interfaces/implementations.
- `packages/worker`: deterministic Temporal workflow and side-effecting activities.
- `packages/api`, `packages/web`: HTTP/SSE API and approval UI.
- `packages/mcp`: MCP v2 stdio integration.
- `evals`: deterministic retrieval and policy regressions; not a measure of live model quality.
- `scripts/demo.ts`: two-path end-to-end demonstration.
- `infra/terraform`: inherited AWS deployment sketch, **not deployed or certified by these checks**.

Read [architecture](ARCHITECTURE.md), [operations](docs/OPERATIONS.md), [security](SECURITY.md), and [contributing](CONTRIBUTING.md).

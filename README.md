# Agent Pipeline

A durable, **human-in-the-loop** agentic task pipeline:

```
task board card → analyze → plan (LLM) → ┌─────────────────────┐ → implement → run tests → open PR → report back
                                         │ HUMAN approves /    │
                          ▲              │ requests changes    │
                          └── revise ────┴─────────────────────┘
```

It pulls a software task from a board, reasons about it with an LLM, **pauses for
a human to approve or revise the plan**, then carries the work out: it branches a
repo, applies the changes, runs the tests, and opens a pull request — reporting
status back to the board. The approval pause is **durable**: if the worker or
backend restarts while waiting, the run resumes on the same decision.

Built on **Temporal** (durable orchestration), the **Vercel AI SDK + Google
Gemini** (reasoning), **Express + SSE** (API), **React + Vite** (UI),
**simple-git + GitHub REST** (execution), and **Trello** (board). Every external
integration has a mock twin, so the whole pipeline **runs end-to-end with zero
credentials** — each real integration switches on only when its env vars are set.

> Why this shape? See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the layering and
> the key engineering decisions (determinism boundary, graceful degradation,
> durable approval, idempotent side-effects).

## Highlights

- **Durable human-in-the-loop.** The plan-approval step is a Temporal `condition`
  wait fed by a signal. State lives in the Temporal service, not the worker — kill
  the worker mid-approval and the run resumes when it comes back (demo below).
- **Graceful degradation.** No `.env`? It runs on a mock board card, a stub
  planner, a real local git workspace, a real test run, and a simulated PR.
- **Real execution.** With a GitHub token it clones your repo, branches, applies
  the approved edits, runs the tests, pushes, and opens a real PR (idempotently).
- **Determinism boundary enforced.** Workflow code does no I/O; all side effects
  are Temporal activities. Verified by the workflow bundle excluding activity code.

## Prerequisites

- **Node 22** — this repo standardizes on it (`nvm use 22` if you use nvm). The
  Makefile selects Node 22 via nvm when present.
- One of:
  - **Docker Desktop** (running) for the fully containerized one-command run, or
  - the **Temporal CLI** (`temporal`) for a fast host dev loop.

## Quick start

### Option A — one command (Docker)

```bash
docker compose up --build
```

Brings up Postgres + Temporal + Temporal Web UI + the worker + the API (which
serves the SPA). Then open:

- **App UI:** http://localhost:3001
- **Temporal Web UI:** http://localhost:8080

### Option B — host dev loop (Node 22 + Temporal CLI)

```bash
nvm use 22
npm install
make dev      # Temporal dev server (UI :8233) + worker + api (:3001) + web (:5173)
```

Open the SPA at **http://localhost:5173** (Vite dev server, proxies `/api` to the
API) and the Temporal UI at **http://localhost:8233**.

Individual processes are also available: `make temporal`, `make worker`,
`make api`, `make web`. Run `make help` for everything.

## Configuration

Copy [`.env.example`](.env.example) to `.env` and set only what you want. With
**none** set, everything runs on mocks/stubs.

| Variable | Enables | Where to get it |
| --- | --- | --- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Real Gemini analyze/plan | https://aistudio.google.com/apikey (free, no card) |
| `LLM_MODEL` | Gemini model id (default `gemini-2.0-flash`) | — |
| `TRELLO_API_KEY` / `TRELLO_TOKEN` / `TRELLO_LIST_ID` | Pull real board cards | https://trello.com/power-ups/admin |
| `GITHUB_TOKEN` / `GITHUB_OWNER` / `GITHUB_REPO` | Clone + push + real PR | https://github.com/settings/tokens (`repo` scope) |
| `TARGET_REPO_PATH` | Operate on a local repo instead of the bundled `sandbox/` | — |
| `MAX_REVISIONS` | Revise attempts before auto-reject (default 3) | — |

Secrets are read only from env / `.env` (never hardcoded, never committed).

## Walkthrough: drive a task from board to PR

Using the **UI** (Option A → :3001, or Option B → :5173):

1. Pick an **inbound task** and click **Start run**.
2. Watch it move `analyzing → planning → awaiting-approval` (live via SSE).
3. Review the proposed **plan** (steps + per-file edits). Click **Approve**, or
   type feedback and **Request changes** to send it back for a revision.
4. On approval it runs `implementing → testing → opening-pr → reporting →
   completed` and shows the PR link.

Same flow over the **API**:

```bash
curl localhost:3001/api/board/tasks                       # the inbound queue
curl -X POST localhost:3001/api/runs \
  -H 'content-type: application/json' -d '{"taskId":"CARD-101"}'   # -> {"runId":"run-CARD-101"}
curl localhost:3001/api/runs/run-CARD-101                 # status (reaches awaiting-approval)
curl -X POST localhost:3001/api/runs/run-CARD-101/decision \
  -H 'content-type: application/json' -d '{"kind":"approve"}'      # or {"kind":"request-changes","feedback":"..."}
curl -N localhost:3001/api/runs/run-CARD-101/events       # live SSE stream until terminal
```

Or with no API, via the worker CLI: `npm run cli -w @pipeline/worker -- start`
then `... approve <runId>`.

With real credentials set, the same run pulls a Trello card, plans with Gemini,
pushes a branch to your GitHub repo, and opens an actual PR.

## Crash-resume demonstration (the durability centerpiece)

The approval pause survives a worker restart because the run's state lives in the
Temporal service + Postgres, not the worker process.

```bash
# 1. Start a run and let it reach awaiting-approval (UI or the curl above).
# 2. Confirm it is paused:
curl -s localhost:3001/api/runs/run-CARD-101 | grep -o '"state":"[^"]*"'   # awaiting-approval

# 3. KILL the worker:
docker compose stop worker         # (Docker)   — or Ctrl-C the `make worker` process

# 4. Approve WHILE THE WORKER IS DOWN — the signal is recorded by Temporal:
curl -X POST localhost:3001/api/runs/run-CARD-101/decision \
  -H 'content-type: application/json' -d '{"kind":"approve"}'   # -> {"ok":true}

# 5. Bring the worker back:
docker compose start worker        # (Docker)   — or `make worker`

# 6. The run RESUMES from the durable decision and finishes (implement → test → PR).
curl -s localhost:3001/api/runs/run-CARD-101 | grep -o '"state":"[^"]*"'   # completed
```

In the Temporal Web UI you can see a `WorkflowExecutionSignaled` event appended to
the run's history while no worker was running.

## Tests

```bash
npm test     # builds, then runs Vitest
```

- Unit tests: config graceful-degradation flags, provider factory mock-vs-real
  selection, mock provider behavior.
- Integration test: the approval flow on Temporal's **time-skipping** test
  environment with mock activities — both the approve path and the
  request-changes → revise → approve path.

## Project layout

```
packages/core    contracts (pure zod) + env-driven provider factory (mock/real)
packages/worker  Temporal workflows (deterministic) + activities (all I/O) + worker + dev CLI
packages/api     Express API + SSE; talks to Temporal; serves the SPA in prod
packages/web     React + Vite single-page app
sandbox/         bundled sample target repo the agent edits/tests/PRs by default
infra/terraform  AWS IaC (ECS Fargate + RDS + ALB + ...) — reviewable, not applied
docker-compose.yml  the full local stack
```

## Infrastructure as code

[`infra/terraform/`](infra/terraform) describes a deployable AWS shape (ECS
Fargate services for Temporal/UI/worker/api, RDS for Temporal persistence, ALB,
Cloud Map, Secrets Manager, ECR). It is **real and `terraform validate`-clean but
intentionally not applied**. See its [README](infra/terraform/README.md), which
also covers using **Temporal Cloud** instead of self-hosting. Validate locally:

```bash
make tf-validate     # runs terraform validate via the hashicorp/terraform image
```

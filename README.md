# Agent Pipeline

A durable, human-in-the-loop agentic task pipeline:

> **board card → analyze → plan (LLM) → HUMAN approves/revises → implement → run tests → open PR → report back**

Built on **Temporal** (durable orchestration that survives crashes and pauses
arbitrarily long for human approval), the **Vercel AI SDK + Google Gemini**
(reasoning), **Express + SSE** (API), and **React + Vite** (UI). It runs
end-to-end on mocks with **zero credentials**; each real integration (Gemini,
Trello, GitHub) activates only when its environment variables are set.

> 🚧 **Under construction.** Built in phases — see `ARCHITECTURE.md` for the
> design. Full env-var reference, one-command run, the board→PR walkthrough, and
> the crash-resume demo are finalized in the last phase.

## Prerequisites

- **Node 22.** This repo standardizes on it (`nvm use 22`). The machine default
  `node` may be older; Makefile host targets select Node 22 via nvm when present.
- One of:
  - **Temporal CLI** (`temporal`) for the fast host dev loop, or
  - **Docker Desktop** (running) for the fully containerized `make up`.

## Quick start (host)

```bash
nvm use 22
npm install
make dev      # Temporal dev server (:8233 UI) + worker + api (:3001) + web (:5173)
```

Or the containerized path (needs Docker Desktop running):

```bash
make up       # Postgres + Temporal + Temporal UI (+ app services, added later)
```

## Layout

| Path | What |
| --- | --- |
| `packages/core`   | Pure-zod **contracts** + env-driven **provider factory** (mock/real). |
| `packages/worker` | Temporal **workflows** (deterministic) + **activities** (all I/O). |
| `packages/api`    | **Express** API + **SSE** live status; talks to Temporal. |
| `packages/web`    | **React + Vite** single-page app (queue, plan, approve/revise). |
| `infra/`          | `docker-compose` (Temporal) + **Terraform** (AWS, reviewable, unapplied). |

## Commands

Run `make help` for the full list. Common ones: `make install`, `make build`,
`make typecheck`, `make test`, `make dev`, `make up`.

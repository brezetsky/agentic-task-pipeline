# Sandbox target repo

A tiny Node.js project used as the **default target** the agent operates on when
no real GitHub repository is configured. The pipeline copies this directory into
`.work/<runId>/`, creates a branch, applies the approved plan's file edits,
runs the tests (`npm test` → `node --test`), commits, and (in real mode) pushes
and opens a PR.

Point the agent at your own repo instead via `TARGET_REPO_PATH` or by setting
the `GITHUB_*` env vars.

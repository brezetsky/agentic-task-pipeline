# Operating the reference deployment

## Supported topology

Run one worker with durable `.work` storage, the API, and a persistent Temporal service. Docker Compose is a loopback-only development deployment with an explicit unauthenticated API override. Do not expose it to the internet. `make dev` must run from the repository root because workspace paths are rooted in the process working directory.

For a remotely accessible deployment:

1. Use a TLS gateway with authentication/rate limits and restricted network access. Set a random `API_AUTH_TOKEN` (32+ characters), `API_ALLOW_UNAUTHENTICATED=false`, and `NODE_ENV=production`. The shared token is single-operator auth, not RBAC.
2. Protect Temporal separately with network policy and an authenticated TLS endpoint. This sample's Temporal client currently uses an address/namespace only; wire TLS/API-key support before using Temporal Cloud. Do not expose Temporal's unauthenticated local endpoint or UI.
3. Keep the worker on an isolated host with only credentials needed for this configured repository. Set `ALLOW_LOCAL_EXECUTION=true` only for trusted target code. The worker runs repository tests as its OS user; it is not safe for arbitrary tenant code.
4. Persist `.work` on the worker host. Backup/retain it consistently with Temporal histories. A replacement worker without the snapshot and tested commit must fail, not invent success. Do not scale replicas until execution storage and per-run leases are redesigned.
5. Verify `npm run check`, `npm run demo`, container builds, `/api/health`, `/api/ready`, and a synthetic approved run before admitting real tasks.

The Terraform directory is inherited illustrative infrastructure. Its public endpoints, secret injection, storage, TLS, and worker topology need a deployment-specific review. This change does not apply or validate that infrastructure as production-safe.

## Health and observability

- `/api/health`: process liveness, no authentication required.
- `/api/ready`: bearer-authenticated Temporal connectivity with a bounded probe; it does not prove a worker is polling.
- `/api/info`: verify which providers are mock vs live; partial credentials select mocks.
- HTTP logs: request ID, method, status, elapsed time. Workflow logs: run ID, state, revision. Temporal itself records activity attempts/failures.
- Task descriptions, plans, source context, and bounded test output enter Temporal history. Configure retention/access and payload encryption before private or regulated data. No PHI is needed for the synthetic demo.

Monitor API error rate/latency, pending workflows, activity retries/timeouts, approval age, failed test ratio, and disk usage. Log records are a starting point; this repository does not ship an OTel collector, alert backend, cost billing ledger, or SLO dashboard.

## Recovery and retries

An approval signal can be recorded while the worker is offline. It is accepted only for the current revision when replay reaches the wait. Restart the worker against the same Temporal history **and the same workspace volume**. The automated restart test uses uncached workflows to force full replay and avoid test-server sticky-queue timing.

Implementation retries reset to the saved base. Tests have a 120-second process deadline and periodic activity heartbeats. A receipt is written only after tests pass with unchanged HEAD and a clean tree; publication verifies it again. Do not edit receipts manually. Pushes never force overwrite remote branches. A divergent branch needs operator investigation and a new task/run, not a force push.

LLM generation has a 60-second request deadline, one SDK retry, 8,000 output-token cap, and up to three Temporal attempts. Revisions are capped at ten by configuration. These are bounded calls, not an exact monetary budget; run live evaluations with separate explicit spending limits.

Board comments are best-effort and may be missing or duplicated. Publication does not depend on them. There is no automatic rollback of a published draft PR.

## Upgrading from the original prototype

The new `preparing` activity and required decision `planRevision` change workflow history/clients. **Drain or terminate old prototype runs before switching workers**, or deploy to a new task queue with a separately versioned workflow type. Do not replay old histories using this workflow without Temporal patch/version migration. Restart tests prove replay for this version only.

Old clients must include `planRevision` from the status response in decisions. `TARGET_REPO_URL` now fails configuration validation because it was not implemented. Protected paths and arbitrary test commands are intentionally rejected. Unauthenticated production startup now fails unless explicitly overridden.

## Data lifecycle

Completed workspaces are not deleted automatically: retain them while the run may be retried or reviewed. After archival, remove only that run's directory, snapshot JSON, and `.tested` receipt. Stop the worker before bulk cleanup. Never use `npm run clean` on a live worker. Configure Temporal retention and disk monitoring before sustained use.

## Remaining engineering work

Hostile-code execution needs ephemeral OS/container/VM isolation, credential-free runners, network egress controls, immutable artifacts, and an authenticated result channel. Horizontal scale needs workspace artifact storage and run ownership/leases. Team use needs identity/RBAC, audit attribution, admission/rate limits, and a durable status read model. Production releases need workflow versioning/replay fixtures, load testing, backup/restore drills, real provider staging tests, and model-quality/cost evaluation. These are explicit limits, not implemented features.

---
name: pipeline-debug
description: Diagnose stalled, rejected, or failed Agent Pipeline runs using Temporal state, execution policy, context snapshots, and validation evidence.
---

Start with a run ID and its latest state from the API or Temporal history. Read `docs/OPERATIONS.md`. Avoid dumping task bodies, generated code, provider responses, or environment values into logs.

- `awaiting-approval`: compare the submitted `planRevision` with `revisions`. Stale or duplicate signals are ignored. An offline worker cannot answer workflow queries; a recorded signal can still be replayed.
- `preparing` or `implementing`: inspect provider error type, workspace availability, and snapshot metadata. `PolicyError` means repair the proposed plan or configuration, not bypass validation. Never manually rewrite a test receipt.
- `testing`: inspect the bounded test output and timeout/cancellation result. A passing command must leave the same clean commit. Custom repos require explicit local-execution opt-in on an isolated host.
- `opening-pr`: distinguish missing/stale test receipts, remote branch divergence, permanent GitHub rejection, and transient provider failure. Do not force-push to resolve divergence.

Reproduce with a synthetic fixture that excludes private data. Add a regression test or evaluation case, apply the narrow fix, and run the relevant gates. Explain whether the fix changes prompt context, deterministic policy, retry behavior, or infrastructure. Do not restart unrelated services or delete execution history as a debugging shortcut.

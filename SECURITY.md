# Security boundaries

This is a trusted-repository, single-operator reference implementation. Do not execute untrusted repositories or send regulated/private data to the demo providers.

## Enforced by code

- Model output must satisfy bounded schemas and a separate path/command policy.
- Paths are repository-relative; traversal, hidden paths, protected controls and symlink ancestors are denied.
- Models cannot modify tests, dependency manifests, agent instructions or infrastructure through the execution policy.
- Approval identifies a specific plan revision. The MCP integration cannot approve, execute, or publish.
- Test subprocesses use fixed argv without a shell, a minimal environment, a temporary HOME, bounded output and process-group cancellation.
- Git credentials are not embedded in clone URLs or saved remotes. Git global config and hooks are disabled by fixed configuration.
- A normal push and draft PR happen only after a clean tested-commit receipt.
- API payloads are bounded/validated. Production mode requires a bearer token unless the operator explicitly enables local-demo bypass.

## Not guaranteed

Repository tests/source can run arbitrary code under the worker UID, inspect the filesystem, use the network, or tamper with local artifacts. Process filtering and test receipts are **not a hostile-code security boundary**. Repository-local npm configuration and trusted test scripts must be reviewed; use an isolated execution environment without private mounts for real targets.

Context filtering excludes obvious sensitive paths, not secrets embedded in otherwise readable source. Snapshot context and test outputs are stored in Temporal history. A prompt telling the model to ignore malicious instructions is defense in depth, not a prompt-injection proof. Policy tests demonstrate rejection of concrete malicious outputs, not universal resistance of an LLM.

The shared API token has no per-user attribution or authorization roles. Browser session storage is accessible to same-origin scripts. Use HTTPS, trusted client code, and an authenticated gateway; do not expose the local Compose ports or Temporal directly.

## Reporting

For a suspected vulnerability, contact the repository owner privately through their GitHub profile before posting exploit details. Include the affected commit, a minimal synthetic reproduction, impact, and proposed mitigation. Never include live tokens or private repository content.

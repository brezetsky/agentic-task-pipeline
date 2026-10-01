# Contributing

Use Node 22.14+ or 24 on Linux/macOS, npm, and Git. Read AGENTS.md for architectural invariants.

```bash
npm ci
npm run check
npm run demo
```

`check` includes lint, typechecking of implementation/tests/scripts, unit and Temporal/MCP integration tests, deterministic evaluations, and the web build. Temporal downloads an ephemeral test-server binary on first use; no paid API credentials are needed. Tests use synthetic fixtures. Run commands from the repository root.

Keep provider-specific I/O behind interfaces and workflows deterministic. Add meaningful negative-path tests when changing execution, approval, context or publication. A test suite pass is evidence for covered behavior, not a claim of production readiness. Explain new limits and migration needs in docs/OPERATIONS.md.

Live provider calls and external side effects require explicit authorization and an isolated environment. Do not commit `.env`, `.work`, local test output, build artifacts or tokens. Use `npm audit` to check the locked dependency tree. CI runs the same gates and builds both container targets.

# Interview walkthrough

Target role: [VisiQuate Senior AI Engineer](https://jobs.dou.ua/companies/visiquate/vacancies/373443/), reviewed October 1, 2026. The role emphasizes backend delivery, agent harnesses, tools/skills/MCP, validation and reliable operations. This project demonstrates a focused subset; it does not establish commercial tenure or healthcare deployment experience.

## Ten-minute demonstration

**0–2 minutes — system and tradeoff.** Explain that an LLM proposes an exact change, while Temporal, policy, tests and a human control execution. Open ARCHITECTURE.md. The hardest boundary is model intent versus executable authority.

**2–4 minutes — real execution and a failed change.** Run `npm run demo`. Point out the context digest, approval checkpoint, real Git commit, original test command, and final JSON. The valid fixture reaches simulated PR publication. The broken arithmetic fixture fails tests and never reaches publication. State clearly that the planner and remote integrations are simulated here.

**4–6 minutes — MCP and context.** Connect an MCP client using the README configuration with the bundled sandbox as root. Invoke `search_repository` with `sum`, inspect path/hash citations, read `pipeline://policy`, and pass a plan editing `../escape` or `package.json` to `review_plan`. Show rejection. Explain why no approval tool exists and why the worker uses the shared modules directly.

**6–8 minutes — durable control.** Show `packages/worker/src/workflows/taskPipeline.test.ts`: revision requests, stale approval rejection, tests blocking publication, and approval while the worker is offline. Explain that restart replay works for this workflow version and that upgrades need versioning or drained histories. If running the UI, request changes and approve the new revision.

**8–10 minutes — engineering evidence.** Show CI, `npm run eval`, the two reusable skills and AGENTS.md. Explain what each gate measures. Close with the deployment limits and the first change you would make for an untrusted multi-tenant workload: an isolated runner with immutable artifacts and separated credentials.

## Requirement-to-evidence map

| Role theme                                  | Implemented evidence                                                                                            | Honest limit                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Backend APIs and asynchronous workflows     | Express validation/auth, Temporal activities/signals/queries, provider adapters                                 | No tenant RBAC or admission-control service                                             |
| LLM-driven business workflow                | Board task → structured Gemini plan → approved implementation → draft PR                                        | Live model/provider smoke requires credentials and was not part of offline verification |
| Retrieval/context engineering               | Bounded lexical retrieval, source hashes, stable base snapshot, retrieval regressions                           | No vector search, embeddings or production RAG benchmark                                |
| Agent environment and reusable capabilities | AGENTS.md, scoped skills, MCP server, policy resource, review prompt                                            | Skills guide coding agents; they do not grant runtime authority                         |
| Multi-step agent harness                    | Separate prepare, analyze, plan, approval, implement, test, publish stages                                      | One planner; no claim of multi-agent reasoning or review-agent accuracy                 |
| Automated validation                        | Lint/type checks, adversarial policy tests, real MCP client, Temporal replay test, two-path real execution demo | Tiny deterministic eval set is not a model-quality score                                |
| Reliability and failure handling            | Finite retries, provider deadlines, revision binding, cancellation, clean-commit publication                    | Single persistent worker; no distributed artifact store                                 |
| Secure, observable operations               | Least-capability MCP, filtered test env, API request IDs, state logs, non-root image                            | No hostile-code isolation, PHI compliance, OTel backend, or cloud deployment claim      |

## Questions to prepare for

- **Why Temporal?** Durable waits, retry history and replay are core requirements; a plain in-process loop loses those semantics. Cost: operating a service and managing deterministic upgrades.
- **Why no agent framework rewrite?** The existing provider seams already isolate model calls. More frameworks would not fix path traversal or pre-test publication.
- **Why allowlist commands if `npm test` can execute anything?** The allowlist stops a model from selecting arbitrary commands; target code still requires a trusted/isolated execution boundary. These solve different risks.
- **Can tests be gamed?** The planner cannot edit tests or scripts, but malicious source can still detect test conditions or attack its host. Stronger assurance requires independent tests, isolation, code review and measured model evaluations.
- **Why lexical retrieval?** Inspectable and reproducible for a small corpus. For larger repositories, measure recall and context utility before adding embeddings/reranking; preserve exact citations and budgets.
- **What does idempotency mean here?** Repeated starts identify the same workflow; edits reset to a captured base; normal push repeats the same commit; PR creation finds an existing open PR. This does not make board comments exactly once.
- **What is the next production milestone?** Isolated runners, immutable artifacts and distributed run ownership; then identity/audit, workflow versioning, live-provider evals, load and recovery testing.

Do not claim to have written everything manually. Explain where coding-agent assistance accelerated work and how executable gates caught integration mistakes. Be ready to navigate and modify one policy or test live.

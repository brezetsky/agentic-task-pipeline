# Validation evidence

Local validation on October 1, 2026 (Node 24, macOS; container builds on Linux with Node 22):

| Check                          | Result                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Original baseline              | 11 tests passed; dependency audit reported 27 advisories                                                               |
| `npm run check`                | Formatting, ESLint, implementation/test/script typechecks, 56 tests across 9 files, evaluation suite, web build passed |
| `npm run eval`                 | 3/3 retrieval fixtures found their expected source in the top 3; 10/10 policy fixtures classified correctly            |
| `npm run demo`                 | Real Temporal/Git/tests; approved valid fixture completed; broken fixture failed; exactly one simulated publication    |
| MCP integration                | Actual stdio SDK handshake/discovery, context search, blocked traversal and policy review passed                       |
| Restart test                   | Approval delivered with worker stopped; replacement worker replayed and completed                                      |
| `npm audit --audit-level=high` | Zero advisories in the checked lockfile at validation time                                                             |
| Containers                     | Both API and worker images built; UID 1000; API health 200, missing token 401, valid token 200, SPA 200                |
| Skills                         | Both SKILL.md files passed the skill frontmatter/name validator                                                        |

[GitHub CI](https://github.com/brezetsky/agentic-task-pipeline/actions/workflows/ci.yml) reruns the executable gates and builds both images for pushed changes. These results cover synthetic fixtures and the listed failure cases; they do not establish live-model quality, broad retrieval accuracy, cloud scalability, penetration-test assurance, or regulatory compliance.

Live Gemini, Trello and GitHub publication calls were not exercised by the offline suite. Terraform was not applied. Review SECURITY.md and docs/OPERATIONS.md before running private or untrusted workloads.

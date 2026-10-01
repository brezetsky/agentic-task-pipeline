import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readRepositoryContext, searchContext, validatePlan } from '@pipeline/core';

async function main() {
  const cases = JSON.parse(await readFile(resolve('evals/cases.json'), 'utf8')) as {
    retrieval: { query: string; expectedPath: string }[];
    policy: { name: string; path: string; command: string; allowed: boolean }[];
  };
  const corpus = await readRepositoryContext(resolve('sandbox'));
  const retrieval = cases.retrieval.map((c) => ({
    query: c.query,
    passed: searchContext(corpus, c.query, 3).some((f) => f.path === c.expectedPath),
  }));
  const policy = cases.policy.map((c) => {
    let allowed = true;
    try {
      validatePlan({
        summary: c.name,
        steps: ['Apply'],
        edits: [{ path: c.path, action: 'create', contents: 'example' }],
        testCommand: c.command,
      });
    } catch {
      allowed = false;
    }
    return { name: c.name, passed: allowed === c.allowed };
  });
  const report = {
    suite: 'deterministic harness regression (not LLM quality)',
    retrievalRecallAt3: retrieval.filter((r) => r.passed).length / retrieval.length,
    policyAccuracy: policy.filter((r) => r.passed).length / policy.length,
    retrieval,
    policy,
  };
  console.log(JSON.stringify(report, null, 2));
  if ([...retrieval, ...policy].some((r) => !r.passed)) process.exitCode = 1;
}
main().catch(() => {
  console.error('Evaluation failed');
  process.exitCode = 1;
});

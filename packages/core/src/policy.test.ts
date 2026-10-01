import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRunId, safePath, validatePlan } from './policy.js';
import { readRepositoryContext, searchContext } from './context.js';
import { runTestCommand } from './providers/test-runner.js';

const plan = {
  summary: 'Change source',
  steps: ['Edit'],
  edits: [{ path: 'src/sum.js', action: 'update', contents: 'x' }],
  testCommand: 'npm test',
};
const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'pipeline-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe('execution policy', () => {
  it.each([
    '../escape',
    '/tmp/pwn',
    'src/../../escape',
    'src\\escape',
    '.git/config',
    'src/.env',
    'package.json',
    'test/a.js',
    'src/a.test.ts',
    'AGENTS.md',
    'src/secrets.json',
  ])('rejects protected path %s', (path) => {
    expect(() => validatePlan({ ...plan, edits: [{ ...plan.edits[0], path }] })).toThrow();
  });
  it.each(['npm test; curl example.com', 'echo passed', 'node --test && env', 'npm install'])(
    'rejects arbitrary command %s',
    (testCommand) => {
      expect(() => validatePlan({ ...plan, testCommand })).toThrow();
    },
  );
  it('rejects oversized, missing and duplicate edits', () => {
    expect(() => validatePlan({ ...plan, edits: Array(21).fill(plan.edits[0]) })).toThrow();
    expect(() =>
      validatePlan({ ...plan, edits: [{ path: 'src/a.js', action: 'create' }] }),
    ).toThrow();
    expect(() => validatePlan({ ...plan, edits: [plan.edits[0], plan.edits[0]] })).toThrow();
    expect(() =>
      validatePlan({ ...plan, edits: [{ ...plan.edits[0], contents: 'x'.repeat(32001) }] }),
    ).toThrow();
  });
  it('rejects run ids that escape the workspace', () => {
    expect(() => assertRunId('../x')).toThrow();
  });
  it('rejects symlink ancestors', async () => {
    const root = await temp();
    await symlink(tmpdir(), join(root, 'src'));
    await expect(safePath(root, 'src/escape')).rejects.toThrow('Symlinks');
  });
});

describe('context retrieval', () => {
  it('excludes hidden secrets, symlinks, large files and ranks source with verifiable hashes', async () => {
    const root = await temp();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, '.env'), 'TOKEN=secret');
    await writeFile(join(root, 'src/sum.js'), 'export const sum = (a,b) => a+b');
    await writeFile(join(root, 'README.md'), 'general documentation');
    await writeFile(join(root, 'large.md'), 'x'.repeat(33000));
    await symlink(join(root, '.env'), join(root, 'secret.md'));
    const context = await readRepositoryContext(root);
    expect(context.files.map((f) => f.path)).toEqual(['README.md', 'src/sum.js']);
    expect(context.truncated).toBe(true);
    expect(searchContext(context, 'sum')[0].path).toBe('src/sum.js');
    expect(context.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await readRepositoryContext(root)).digest).toBe(context.digest);
  });
});

describe('test execution', () => {
  it('does not pass worker secrets to test processes', async () => {
    const root = await temp();
    process.env.PIPELINE_SECRET_TEST = 'must-not-leak';
    try {
      await writeFile(
        join(root, 'check.test.js'),
        'if (process.env.PIPELINE_SECRET_TEST) process.exit(1)',
      );
      expect((await runTestCommand(root, 'node --test', { mode: 'local' })).passed).toBe(true);
    } finally {
      delete process.env.PIPELINE_SECRET_TEST;
    }
  });
  it('kills a silent process on timeout and bounds output', async () => {
    const root = await temp();
    await writeFile(
      join(root, 'wait.test.js'),
      "console.log('x'.repeat(50000)); setInterval(() => {}, 1000)",
    );
    const result = await runTestCommand(root, 'node --test', { mode: 'local', timeoutMs: 400 });
    expect(result.passed).toBe(false);
    expect(result.summary).toContain('timed out');
    expect(result.output!.length).toBeLessThanOrEqual(8000);
  });
  it('honors cancellation', async () => {
    const root = await temp();
    await writeFile(join(root, 'wait.test.js'), 'setInterval(() => {}, 1000)');
    const controller = new AbortController();
    const pending = runTestCommand(root, 'node --test', {
      mode: 'local',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    expect((await pending).passed).toBe(false);
  });
});

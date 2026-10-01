import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { runTestCommand } from './test-runner.js';
const exec = promisify(execFile);
const dockerTest = it.skipIf(process.env.RUN_DOCKER_TESTS !== '1');

async function fixture(code: string) {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-container-fixture-'));
  await writeFile(join(dir, 'check.test.js'), code);
  await exec('git', ['init'], { cwd: dir });
  await exec('git', ['add', '.'], { cwd: dir });
  await exec(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-m',
      'fixture',
    ],
    { cwd: dir },
  );
  return dir;
}

dockerTest(
  'isolates filesystem, network, credentials and writes from the worker',
  async () => {
    const dir = await fixture(`
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const test = require('node:test');
test('boundary', async () => {
  assert.equal(process.getuid(), 1000);
  for (const key of ['GITHUB_TOKEN', 'API_AUTH_TOKEN', 'GOOGLE_GENERATIVE_AI_API_KEY', 'DOCKER_HOST']) assert.equal(process.env[key], undefined);
  for (const path of ['/var/run/docker.sock', '/app/.work', '/workspace/.git', '/workspace/untracked-secret']) assert.equal(fs.existsSync(path), false);
  assert.throws(() => fs.writeFileSync('/etc/escape', 'bad'));
  assert(Object.values(os.networkInterfaces()).flat().every(i => i.internal));
  await assert.rejects(fetch('http://1.1.1.1', {signal: AbortSignal.timeout(1000)}));
  fs.writeFileSync('/workspace/result', 'container-only');
  fs.writeFileSync('/tmp/result', 'ok');
});
`);
    await writeFile(join(dir, 'untracked-secret'), 'must not enter execution');
    vi.stubEnv('GITHUB_TOKEN', 'sentinel-worker-secret');
    vi.stubEnv('API_AUTH_TOKEN', 'sentinel-api-secret');
    try {
      const result = await runTestCommand(dir, 'node --test');
      expect(result, result.output).toMatchObject({ passed: true });
      await expect(readFile(join(dir, 'result'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000,
);

dockerTest(
  'fails closed when the runner image is missing',
  async () => {
    const dir = await fixture('');
    try {
      const result = await runTestCommand(dir, 'node --test', {
        image: 'pipeline-missing-image:never-pull',
      });
      expect(result.passed).toBe(false);
      expect(result.summary).toContain('unavailable');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000,
);

dockerTest(
  'enforces limits and removes its container after cancellation',
  async () => {
    const dir = await fixture('setInterval(() => {}, 1000);');
    const controller = new AbortController();
    const pending = runTestCommand(dir, 'node --test', { signal: controller.signal });
    let name: string | undefined;
    try {
      for (let i = 0; i < 100; i++) {
        const { stdout } = await exec('docker', [
          'ps',
          '--filter',
          'name=pipeline-test-',
          '--format',
          '{{.Names}}',
        ]);
        name = stdout.trim().split('\n').find(Boolean);
        if (name) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(name).toBeTruthy();
      const { stdout } = await exec('docker', ['inspect', name!]);
      const container = JSON.parse(stdout)[0];
      expect(container.HostConfig).toMatchObject({
        NetworkMode: 'none',
        ReadonlyRootfs: true,
        Memory: 268435456,
        MemorySwap: 268435456,
        NanoCpus: 1000000000,
        PidsLimit: 64,
        CapDrop: ['ALL'],
      });
      expect(container.HostConfig.SecurityOpt).toContain('no-new-privileges:true');
      expect(container.HostConfig.Binds).toBeNull();
      controller.abort();
      expect((await pending).passed).toBe(false);
      await expect(exec('docker', ['inspect', name!])).rejects.toThrow();
    } finally {
      controller.abort();
      await pending;
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000,
);

dockerTest(
  'terminates timed-out code and reports failure',
  async () => {
    const dir = await fixture('setInterval(() => {}, 1000);');
    try {
      const result = await runTestCommand(dir, 'node --test', { timeoutMs: 1000 });
      expect(result.passed).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  30_000,
);

dockerTest(
  'reports a failing test as failure instead of a successful Docker launch',
  async () => {
    const dir = await fixture("require('node:assert/strict').equal(1, 2);");
    try {
      const result = await runTestCommand(dir, 'node --test');
      expect(result.passed).toBe(false);
      expect(result.summary).toContain('exit code 1');
      expect(result.output).toContain('AssertionError');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  30_000,
);

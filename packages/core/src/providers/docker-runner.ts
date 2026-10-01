import { execFile, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { TestResult } from '../contracts/index.js';
import type { RunTestOptions } from './test-runner.js';

const exec = promisify(execFile);

/** Only a committed archive crosses the boundary; no host path or credentials are mounted. */
export async function runDockerTest(
  dir: string,
  command: string,
  opts: RunTestOptions,
): Promise<TestResult> {
  const staging = await mkdtemp(join(tmpdir(), 'pipeline-archive-'));
  const archive = join(staging, 'source.tar');
  const name = `pipeline-test-${randomUUID()}`;
  const timeout = Math.min(opts.timeoutMs ?? 120_000, 120_000);
  let created = false;
  try {
    await exec(
      'git',
      ['-c', 'core.hooksPath=/dev/null', 'archive', '--format=tar', `--output=${archive}`, 'HEAD'],
      {
        cwd: dir,
        timeout: 15_000,
        env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
      },
    );
    if ((await stat(archive)).size > 64 * 1024 * 1024)
      return { passed: false, summary: 'Repository archive exceeds the 64 MiB execution limit' };
    if (opts.signal?.aborted) return { passed: false, summary: 'Tests cancelled before start' };
    await exec(
      'docker',
      [
        'create',
        '--rm',
        '--pull=never',
        '--name',
        name,
        '--interactive',
        '--init',
        '--network=none',
        '--read-only',
        '--user=1000:1000',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--pids-limit=64',
        '--memory=256m',
        '--memory-swap=256m',
        '--cpus=1',
        '--log-driver=none',
        '--tmpfs=/workspace:rw,nosuid,nodev,size=128m,uid=1000,gid=1000',
        '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m,uid=1000,gid=1000',
        '--workdir=/workspace',
        '--env=HOME=/tmp',
        '--env=CI=true',
        '--env=NODE_ENV=test',
        '--env=npm_config_ignore_scripts=true',
        '--env=npm_config_cache=/tmp/npm-cache',
        '--entrypoint=/bin/sh',
        opts.image ?? 'node:22-slim',
        '-c',
        `exec timeout -s KILL ${Math.ceil(timeout / 1000)}s /bin/sh -c 'tar --no-same-owner -xf - && exec ${command}'`,
      ],
      { timeout: 30_000 },
    );
    created = true;
    if (opts.signal?.aborted) return { passed: false, summary: 'Tests cancelled before start' };
    return await new Promise<TestResult>((resolve) => {
      const child = spawn('docker', ['start', '--attach', '--interactive', name], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const input = createReadStream(archive);
      let output = '';
      let stopped = false;
      const stop = () => {
        stopped = true;
        child.kill('SIGKILL');
      };
      const timer = setTimeout(stop, timeout + 5000);
      opts.signal?.addEventListener('abort', stop, { once: true });
      if (opts.signal?.aborted) stop();
      input.on('error', stop);
      child.stdin.on('error', () => {
        /* container can exit before consuming the archive */
      });
      input.pipe(child.stdin);
      const onData = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8000);
        opts.onLine?.(chunk.toString().slice(-1000));
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', () => {
        stopped = true;
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', stop);
        input.destroy();
        resolve({
          passed: !stopped && code === 0,
          summary: stopped
            ? 'Isolated tests cancelled or timed out'
            : code === 0
              ? 'Isolated tests passed'
              : `Isolated tests failed with exit code ${code}`,
          output,
        });
      });
    });
  } catch {
    // Docker diagnostics can include operator configuration; keep them out of workflow history.
    return {
      passed: false,
      summary: 'Isolated runner unavailable; check Docker and the preloaded runner image',
    };
  } finally {
    // Do not silently fall back to host execution or leave running code after cancellation.
    if (created) {
      await exec('docker', ['rm', '--force', name], { timeout: 15_000 }).catch(
        (error: { stderr?: string }) => {
          // --rm also cleans up if the worker disappears and the container exits.
          if (!error.stderr?.includes('No such container'))
            throw new Error('Failed to remove isolated test container');
        },
      );
    }
    await rm(staging, { recursive: true, force: true });
  }
}

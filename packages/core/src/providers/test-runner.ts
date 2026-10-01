import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { runDockerTest } from './docker-runner.js';
import type { TestResult } from '../contracts/index.js';
import { EXECUTION_POLICY, PolicyError } from '../policy.js';

export interface RunTestOptions {
  mode?: 'docker' | 'local';
  image?: string;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
  timeoutMs?: number;
}

/** Docker by default; local mode is reserved for explicitly trusted development fixtures. */
export async function runTestCommand(
  dir: string,
  command: string,
  opts: RunTestOptions = {},
): Promise<TestResult> {
  if (!(EXECUTION_POLICY.testCommands as readonly string[]).includes(command))
    throw new PolicyError('Test command is not allowed');
  if (opts.signal?.aborted) return { passed: false, summary: 'Tests cancelled before start' };
  if (opts.mode !== 'local') return runDockerTest(dir, command, opts);
  const home = await mkdtemp(join(tmpdir(), 'pipeline-test-'));
  try {
    return await new Promise<TestResult>((resolve) => {
      const [executable, ...args] = command.split(' ');
      const child = spawn(executable, args, {
        cwd: dir,
        shell: false,
        detached: process.platform !== 'win32',
        env: {
          PATH: process.env.PATH,
          HOME: home,
          CI: 'true',
          NODE_ENV: 'test',
          npm_config_ignore_scripts: 'true',
          npm_config_cache: `${home}/.npm-cache`,
        },
      });
      let output = '';
      let stopped = false;
      let settled = false;
      const kill = () => {
        stopped = true;
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          /* already exited */
        }
      };
      const timer = setTimeout(kill, opts.timeoutMs ?? 120_000);
      opts.signal?.addEventListener('abort', kill, { once: true });
      // Cancellation may arrive during the asynchronous temporary-directory setup.
      if (opts.signal?.aborted) kill();
      const finish = (result: TestResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', kill);
        resolve(result);
      };
      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        output = (output + text).slice(-8000);
        opts.onLine?.(text.slice(-1000));
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', () =>
        finish({ passed: false, summary: 'Test process could not start', output }),
      );
      child.on('close', (code) =>
        finish({
          passed: !stopped && code === 0,
          summary: stopped
            ? 'Tests timed out or were cancelled'
            : code === 0
              ? 'Tests passed'
              : `Tests failed with exit code ${code}`,
          output,
        }),
      );
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

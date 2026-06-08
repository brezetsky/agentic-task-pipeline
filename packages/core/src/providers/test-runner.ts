/**
 * Runs the project's test command in a working copy. Streams output lines to an
 * optional `onLine` callback (the activity wires this to Temporal heartbeats so
 * long suites don't time out) and supports cancellation via an AbortSignal.
 */
import { spawn } from 'node:child_process';
import type { TestResult } from '../contracts/index.js';

export interface RunTestOptions {
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}

export function runTestCommand(dir: string, command: string, opts: RunTestOptions = {}): Promise<TestResult> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], { cwd: dir, signal: opts.signal });
    let output = '';

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split('\n')) {
        if (line.trim()) opts.onLine?.(line);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err) => {
      resolve({ passed: false, summary: `Could not run "${command}": ${err.message}`, output: output.slice(-4000) });
    });
    child.on('close', (code) => {
      resolve({
        passed: code === 0,
        summary: code === 0 ? `Tests passed ("${command}").` : `Tests failed with exit code ${code}.`,
        output: output.slice(-4000),
      });
    });
  });
}

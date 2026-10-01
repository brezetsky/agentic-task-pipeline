import { lstat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { PlanSchema, type Plan } from './contracts/index.js';

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

export const EXECUTION_POLICY = {
  maxEdits: 20,
  maxFileBytes: 32_000,
  maxPlanBytes: 128_000,
  testCommands: ['npm test', 'node --test'],
  writableRoots: ['src/', 'lib/', 'docs/'],
  description:
    'Source/docs only. No secrets, hidden files, symlinks, tests, dependencies, agent instructions, or infrastructure edits. Human approval never overrides this policy.',
} as const;

export function assertRunId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new PolicyError('Invalid run id');
}

export function assertRelativePath(path: string): void {
  // Reject control characters before filesystem or Git use.
  if (
    !path ||
    path.length > 240 ||
    !/^[a-zA-Z0-9_][a-zA-Z0-9_. /-]*$/.test(path) ||
    path.startsWith('/') ||
    path.split('/').some((p) => !p || p === '.' || p === '..' || p.startsWith('.'))
  ) {
    throw new PolicyError('Path must be a normalized, non-hidden repository-relative path');
  }
}

export function assertEditable(path: string): void {
  assertRelativePath(path);
  const lower = path.toLowerCase();
  if (
    /(^|\/)(agents\.md|claude\.md|skill\.md|package[^/]*\.json|.*lock.*|.*\.pem|.*\.key|.*credentials.*|.*secret.*|test|tests|__tests__)(\/|$)/.test(
      lower,
    ) ||
    /\.(test|spec)\./.test(lower) ||
    !(
      EXECUTION_POLICY.writableRoots.some((root) => lower.startsWith(root)) ||
      /^[^/]+\.md$/.test(lower)
    )
  ) {
    throw new PolicyError(`Protected path: ${path}`);
  }
}

export async function safePath(root: string, path: string): Promise<string> {
  assertRelativePath(path);
  const base = resolve(root);
  const target = resolve(base, path);
  if (!target.startsWith(base + sep)) throw new PolicyError('Path escapes workspace');
  let current = base;
  for (const segment of path.split('/')) {
    current = resolve(current, segment);
    const stat = await lstat(current).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return undefined;
      throw e;
    });
    if (stat?.isSymbolicLink()) throw new PolicyError('Symlinks are not allowed');
  }
  return target;
}

export function validatePlan(input: unknown): Plan {
  const parsed = PlanSchema.safeParse(input);
  if (!parsed.success) throw new PolicyError('Plan does not match the bounded plan schema');
  const plan = parsed.data;
  if (!(EXECUTION_POLICY.testCommands as readonly string[]).includes(plan.testCommand)) {
    throw new PolicyError('Test command is not allowed');
  }
  if (Buffer.byteLength(JSON.stringify(plan)) > EXECUTION_POLICY.maxPlanBytes)
    throw new PolicyError('Plan exceeds byte budget');
  const seen = new Set<string>();
  for (const edit of plan.edits) {
    assertEditable(edit.path);
    if (seen.has(edit.path.toLowerCase())) throw new PolicyError('Duplicate edit path');
    seen.add(edit.path.toLowerCase());
    if (edit.action !== 'delete' && edit.contents === undefined)
      throw new PolicyError('Missing file contents');
    if (Buffer.byteLength(edit.contents ?? '') > EXECUTION_POLICY.maxFileBytes)
      throw new PolicyError('File exceeds byte budget');
  }
  return plan;
}

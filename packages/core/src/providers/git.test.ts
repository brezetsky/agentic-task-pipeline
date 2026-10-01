import { readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { GitWorkspace, workspaceDir } from './git.js';
import { runTestCommand } from './test-runner.js';
import type { Plan } from '../contracts/index.js';
const ids: string[] = [];
afterEach(async () => {
  for (const id of ids.splice(0)) {
    await rm(workspaceDir(id), { recursive: true, force: true });
    await rm(`${workspaceDir(id)}.json`, { force: true });
    await rm(`${workspaceDir(id)}.tested`, { force: true });
  }
});
function setup() {
  const runId = `test-${randomUUID()}`;
  ids.push(runId);
  return {
    runId,
    branch: `agent/${runId}`,
    workspace: new GitWorkspace(loadConfig({})),
    message: 'test edit',
  };
}
const plan: Plan = {
  summary: 'Document',
  steps: ['Write docs'],
  edits: [{ path: 'CHANGES.md', action: 'create', contents: 'Reviewed change' }],
  testCommand: 'npm test',
};
it('applies a snapshot deterministically and gates publication on a clean tested commit', async () => {
  const args = setup();
  const context = await args.workspace.prepare(args.runId);
  expect(context.files.some((f) => f.path === 'src/sum.js')).toBe(true);
  const first = await args.workspace.implement({ ...args, plan });
  expect(first.filesChanged).toEqual(['CHANGES.md']);
  await expect(args.workspace.publish(args.runId, args.branch)).rejects.toThrow('tested');
  await args.workspace.implement({ ...args, plan }); // retry resets to same trusted snapshot
  expect(await readFile(resolve(workspaceDir(args.runId), 'CHANGES.md'), 'utf8')).toBe(
    'Reviewed change',
  );
  const head = await args.workspace.head(args.runId);
  expect(
    (await runTestCommand(workspaceDir(args.runId), 'npm test', { mode: 'local' })).passed,
  ).toBe(true);
  await args.workspace.recordTestSuccess(args.runId, head);
  await args.workspace.publish(args.runId, args.branch); // simulated, no network
  await writeFile(resolve(workspaceDir(args.runId), 'src/sum.js'), 'modified after tests');
  await expect(args.workspace.publish(args.runId, args.branch)).rejects.toThrow('clean');
});
it('rejects an invented update and overwriting a file via create', async () => {
  const args = setup();
  await expect(
    args.workspace.implement({
      ...args,
      plan: { ...plan, edits: [{ path: 'src/missing.js', action: 'update', contents: 'x' }] },
    }),
  ).rejects.toThrow('planning context');
  await expect(
    args.workspace.implement({
      ...args,
      plan: { ...plan, edits: [{ path: 'src/sum.js', action: 'create', contents: 'x' }] },
    }),
  ).rejects.toThrow('overwrite');
});

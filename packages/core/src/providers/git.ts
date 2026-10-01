import { cp, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { AppConfig } from '../config.js';
import type { ImplementResult, Plan } from '../contracts/index.js';
import { hash, readRepositoryContext, type RepositoryContext } from '../context.js';
import { assertRunId, PolicyError, safePath, validatePlan } from '../policy.js';

export function workspaceDir(runId: string): string {
  assertRunId(runId);
  return resolve(process.cwd(), '.work', runId);
}
interface Snapshot {
  base: string;
  context: RepositoryContext;
}
const metadata = (id: string) => `${workspaceDir(id)}.json`;
const receipt = (id: string) => `${workspaceDir(id)}.tested`;

export class GitWorkspace {
  constructor(private readonly cfg: AppConfig) {}

  private git(dir?: string, authenticated = false): SimpleGit {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    };
    if (authenticated && this.cfg.github.enabled) {
      env.GIT_CONFIG_COUNT = '1';
      env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
      env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${this.cfg.github.token}`).toString('base64')}`;
    }
    // These opt-ins permit only our hard-coded restrictive settings, never model input.
    return simpleGit(dir, {
      timeout: { block: 120_000 },
      unsafe: {
        allowUnsafeHooksPath: true,
        allowUnsafeProtocolOverride: true,
        allowUnsafeConfigPaths: true,
        allowUnsafeConfigEnvCount: true,
      },
      config: ['core.hooksPath=/dev/null', 'protocol.file.allow=never', 'protocol.ext.allow=never'],
    }).env(env);
  }

  async prepare(runId: string): Promise<RepositoryContext> {
    const dir = workspaceDir(runId);
    const saved = await readFile(metadata(runId), 'utf8').catch(() => undefined);
    if (saved) return (JSON.parse(saved) as Snapshot).context;
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    if (this.cfg.github.enabled) {
      const { owner, repo, baseBranch } = this.cfg.github;
      await this.git(undefined, true).clone(`https://github.com/${owner}/${repo}.git`, dir, [
        '--branch',
        baseBranch,
        '--single-branch',
      ]);
    } else {
      const source = resolve(this.cfg.targetRepo.path ?? resolve(process.cwd(), 'sandbox'));
      if (dir === source || dir.startsWith(source + '/'))
        throw new PolicyError('Source cannot contain the workspace');
      await cp(source, dir, {
        recursive: true,
        dereference: false,
        filter: (path) => {
          const parts = relative(source, path).split(/[\\/]/);
          return !parts.some(
            (part) => part.startsWith('.') || ['node_modules', 'dist', 'coverage'].includes(part),
          );
        },
      });
    }
    const git = this.git(dir);
    if (!this.cfg.github.enabled) await git.init();
    await git.addConfig('user.email', 'agent@pipeline.local');
    await git.addConfig('user.name', 'Agent Pipeline');
    if (!this.cfg.github.enabled) {
      await git.add('.');
      await git.commit('chore: trusted base snapshot', undefined, { '--allow-empty': null });
    }
    const context = await readRepositoryContext(dir);
    const snapshot: Snapshot = { base: (await git.revparse(['HEAD'])).trim(), context };
    await writeFile(`${metadata(runId)}.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(`${metadata(runId)}.tmp`, metadata(runId));
    return context;
  }

  async implement(args: {
    runId: string;
    branch: string;
    plan: Plan;
    message: string;
  }): Promise<ImplementResult> {
    const { runId, branch, message } = args;
    if (branch !== `agent/${runId}`) throw new PolicyError('Branch must belong to this run');
    const plan = validatePlan(args.plan);
    await this.prepare(runId);
    const snapshot = JSON.parse(await readFile(metadata(runId), 'utf8')) as Snapshot;
    const dir = workspaceDir(runId);
    const git = this.git(dir);
    await rm(receipt(runId), { force: true });
    await git.reset(['--hard', snapshot.base]);
    await git.clean('fdx');
    await git.checkout(['-B', branch, snapshot.base]);
    for (const edit of plan.edits) {
      const target = await safePath(dir, edit.path);
      const original = snapshot.context.files.find((f) => f.path === edit.path);
      const current = await readFile(target, 'utf8').catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return undefined;
        throw e;
      });
      if (edit.action === 'create' && current !== undefined)
        throw new PolicyError('Create would overwrite an existing file');
      if (
        edit.action !== 'create' &&
        (!original || current === undefined || hash(current) !== original.sha256)
      ) {
        throw new PolicyError(
          'Update/delete requires an unchanged file present in planning context',
        );
      }
      if (edit.action === 'delete') await unlink(target);
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, edit.contents!);
      }
    }
    await git.add(plan.edits.map((e) => e.path));
    const commit = await git.commit(message, undefined, { '--allow-empty': null });
    return { branch, filesChanged: plan.edits.map((e) => e.path), commitSha: commit.commit };
  }

  async head(runId: string): Promise<string> {
    return (await this.git(workspaceDir(runId)).revparse(['HEAD'])).trim();
  }

  async recordTestSuccess(runId: string, expectedHead: string): Promise<void> {
    const git = this.git(workspaceDir(runId));
    if ((await this.head(runId)) !== expectedHead || !(await git.status()).isClean()) {
      throw new PolicyError('Workspace changed while tests ran');
    }
    await writeFile(receipt(runId), expectedHead, { mode: 0o600 });
  }

  async publish(runId: string, branch: string): Promise<void> {
    if (branch !== `agent/${runId}`) throw new PolicyError('Branch must belong to this run');
    const git = this.git(workspaceDir(runId), true);
    const tested = await readFile(receipt(runId), 'utf8').catch(() => '');
    if (tested !== (await this.head(runId)) || !(await git.status()).isClean()) {
      throw new PolicyError('Publication requires a clean, tested commit');
    }
    if (this.cfg.github.enabled) {
      // Normal push is repeatable for the same commit and fails closed on remote divergence.
      await git.push(['origin', `HEAD:refs/heads/${branch}`]);
    }
  }
}

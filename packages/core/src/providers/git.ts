/**
 * Git execution. Prepares an isolated working copy under `.work/<runId>`, then
 * branches, applies the plan's file edits, and commits. In real mode it clones
 * the configured GitHub repo and pushes the branch; in mock mode it copies the
 * bundled sandbox repo and commits locally (no push).
 */
import { cp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { simpleGit } from 'simple-git';
import type { AppConfig } from '../config.js';
import type { FileEdit, ImplementResult } from '../contracts/index.js';

/** Deterministic working directory for a run (shared by implement + test). */
export function workspaceDir(runId: string): string {
  return resolve(process.cwd(), '.work', runId);
}

export class GitWorkspace {
  constructor(private readonly cfg: AppConfig) {}

  async implement(args: {
    runId: string;
    branch: string;
    edits: FileEdit[];
    message: string;
  }): Promise<ImplementResult> {
    const { runId, branch, edits, message } = args;
    const dir = workspaceDir(runId);

    // Start from a clean working copy so retries are deterministic.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    const real = this.cfg.github.enabled;
    if (real) {
      const { token, owner, repo } = this.cfg.github;
      const url = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
      await simpleGit().clone(url, dir);
    } else {
      const source = this.cfg.targetRepo.path ?? resolve(process.cwd(), 'sandbox');
      await cp(source, dir, { recursive: true });
    }

    const git = simpleGit(dir);
    if (!real) await git.init();
    await git.addConfig('user.email', 'agent@pipeline.local');
    await git.addConfig('user.name', 'Agent Pipeline');
    if (!real) {
      await git.add('.');
      await git.commit('chore: agent base snapshot', undefined, { '--allow-empty': null });
    }

    await git.checkout(['-B', branch]);

    const filesChanged: string[] = [];
    for (const edit of edits) {
      const target = resolve(dir, edit.path);
      if (edit.action === 'delete') {
        await unlink(target).catch(() => undefined);
      } else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, edit.contents ?? '');
      }
      filesChanged.push(edit.path);
    }

    await git.add('.');
    const commit = await git.commit(message, undefined, { '--allow-empty': null });

    if (real) {
      await git.push(['-u', 'origin', branch, '--force']);
    }

    return { branch, filesChanged, commitSha: commit.commit };
  }
}

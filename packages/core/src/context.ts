import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertRelativePath, safePath } from './policy.js';

export interface ContextFile {
  path: string;
  contents: string;
  sha256: string;
}
export interface RepositoryContext {
  files: ContextFile[];
  digest: string;
  truncated: boolean;
}
export const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const excluded =
  /(^|\/)(node_modules|dist|coverage|vendor|credentials[^/]*|secrets?[^/]*)(\/|$)|\.(pem|key|p12|lock)$|lock\.json$/i;
const extensions = /\.(md|ts|tsx|js|jsx|json|py|go|java|cs)$/i;

/** A bounded, deterministic lexical corpus. Hidden files, symlinks and binaries never enter model context. */
export async function readRepositoryContext(root: string): Promise<RepositoryContext> {
  const files: ContextFile[] = [];
  let bytes = 0;
  let visited = 0;
  let truncated = false;
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) {
      truncated = true;
      return;
    }
    const entries = await readdir(resolve(root, dir), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (++visited > 2000 || files.length >= 100 || bytes >= 96_000) {
        truncated = true;
        return;
      }
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || excluded.test(path)) continue;
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !extensions.test(path)) continue;
      const target = await safePath(root, path);
      const stat = await lstat(target);
      if (stat.size > 32_000 || bytes + stat.size > 96_000) {
        truncated = true;
        continue;
      }
      const contents = await readFile(target, 'utf8');
      if (contents.includes('\0')) continue;
      files.push({ path, contents, sha256: hash(contents) });
      bytes += Buffer.byteLength(contents);
    }
  }
  await walk('', 0);
  return { files, digest: hash(JSON.stringify(files)), truncated };
}

/** Ranked lexical retrieval with exact source paths, content hashes, and bounded excerpts. */
export function searchContext(context: RepositoryContext, query: string, limit = 5): ContextFile[] {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [])];
  return context.files
    .map((file) => ({
      file,
      score: terms.reduce(
        (score, term) =>
          score +
          (file.path.toLowerCase().includes(term) ? 5 : 0) +
          (file.contents.toLowerCase().includes(term) ? 1 : 0),
        0,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, Math.min(10, Math.max(1, limit)))
    .map(({ file }) => file);
}

export function contextFile(context: RepositoryContext, path: string): ContextFile | undefined {
  assertRelativePath(path);
  return context.files.find((file) => file.path === path);
}

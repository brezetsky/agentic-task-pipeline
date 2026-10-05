/**
 * Pull-request provider. Real implementation talks to the GitHub REST API with
 * the built-in `fetch` (no SDK dependency). It is idempotent — it lists open
 * PRs for the head branch first and treats GitHub's 422 "already exists" as
 * success — so Temporal activity retries never create duplicate PRs. A 4xx
 * (other than 422) is surfaced as a non-retryable `PrError`.
 */
import type { AppConfig } from '../config.js';
import type { PrResult } from '../contracts/index.js';
import type { OpenPrArgs, PrProvider } from './types.js';

/** Thrown for client errors (bad token, etc.). The workflow lists 'PrError' in
 *  `nonRetryableErrorTypes`, so Temporal fails fast instead of hammering GitHub. */
export class PrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrError';
  }
}

export class MockPrProvider implements PrProvider {
  readonly name = 'mock';
  async openPr({ branch, title }: OpenPrArgs): Promise<PrResult> {
    return {
      url: `https://example.invalid/pull/${encodeURIComponent(branch)}`,
      title,
      simulated: true,
    };
  }
}

interface GhPr {
  html_url: string;
  number: number;
  title: string;
}

export class GitHubPrProvider implements PrProvider {
  readonly name = 'github';
  constructor(private readonly gh: AppConfig['github']) {}

  private get api(): string {
    return `https://api.github.com/repos/${this.gh.owner}/${this.gh.repo}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.gh.token}`,
      Accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async findOpen(branch: string): Promise<PrResult | null> {
    const res = await fetch(
      `${this.api}/pulls?${new URLSearchParams({ head: `${this.gh.owner}:${branch}`, state: 'open' })}`,
      {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) this.fail(res.status);
    const prs = (await res.json()) as GhPr[];
    const pr = prs[0];
    return pr ? { url: pr.html_url, number: pr.number, title: pr.title, simulated: false } : null;
  }

  async openPr({ branch, base, title, body }: OpenPrArgs): Promise<PrResult> {
    const existing = await this.findOpen(branch);
    if (existing) return existing;

    const res = await fetch(`${this.api}/pulls`, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ title, head: branch, base, body, draft: true }),
    });

    if (res.ok) {
      const pr = (await res.json()) as GhPr;
      return { url: pr.html_url, number: pr.number, title: pr.title, simulated: false };
    }
    if (res.status === 422) {
      const again = await this.findOpen(branch);
      if (again) return again;
      throw new PrError(`GitHub returned 422 but no open PR found for ${branch}.`);
    }
    this.fail(res.status);
  }

  private fail(status: number): never {
    // Do not include provider bodies: they may contain private repository data.
    if (status >= 400 && status < 500 && ![408, 429].includes(status)) {
      throw new PrError(`GitHub request rejected (${status})`);
    }
    throw new Error(`GitHub temporarily unavailable (${status})`);
  }
}

export function createPrProvider(cfg: AppConfig): PrProvider {
  return cfg.github.enabled ? new GitHubPrProvider(cfg.github) : new MockPrProvider();
}

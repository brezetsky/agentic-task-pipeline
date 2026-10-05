import { afterEach, expect, it, vi } from 'vitest';
import { GitHubPrProvider, PrError } from './github.js';
const provider = new GitHubPrProvider({
  enabled: true,
  owner: 'owner',
  repo: 'repo',
  token: 'test-secret',
  baseBranch: 'main',
});
const args = { branch: 'agent/run-1', base: 'main', title: 'Test', body: 'Evidence' };
const pr = { html_url: 'https://github.com/owner/repo/pull/1', number: 1, title: 'Test' };
afterEach(() => vi.unstubAllGlobals());
it('reuses an existing PR without mutation', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json([pr]));
  vi.stubGlobal('fetch', fetch);
  expect((await provider.openPr(args)).number).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain('agent%2Frun-1');
});
it('creates a draft and recovers a duplicate-creation race', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(new Response('', { status: 422 }))
    .mockResolvedValueOnce(Response.json([pr]));
  vi.stubGlobal('fetch', fetch);
  expect((await provider.openPr(args)).number).toBe(1);
  expect(JSON.parse(fetch.mock.calls[1][1].body).draft).toBe(true);
});
it('fails without creating after a denied lookup and does not include response bodies', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response('sensitive provider details', { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  await expect(provider.openPr(args)).rejects.toThrow(PrError);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([429, 500, 503])('keeps transient HTTP %s failures retryable', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
  await expect(provider.openPr(args)).rejects.not.toBeInstanceOf(PrError);
});

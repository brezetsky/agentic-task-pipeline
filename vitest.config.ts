import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
    // Temporal's test server + worker bundling can be slow on first run.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Native addons (Temporal core bridge) are happiest in forked processes.
    pool: 'forks',
  },
});

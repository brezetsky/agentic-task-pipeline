import express from 'express';
import { loadConfig } from '@pipeline/core';
import type { RunStatus } from '@pipeline/core/contracts';

export const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'agent-pipeline-api' });
});

// Real routes (POST /runs, GET /runs, GET /runs/:id, POST /runs/:id/decision,
// GET /runs/:id/events SSE) are added in Phase 3.
export type ApiRunStatus = RunStatus;

if (require.main === module) {
  const cfg = loadConfig();
  app.listen(cfg.api.port, () => {
    console.log(`[api] listening on http://localhost:${cfg.api.port}`);
  });
}

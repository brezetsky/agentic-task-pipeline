import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createBoardProvider, loadConfig, loadEnv, type AppConfig } from '@pipeline/core';
import { DecisionSchema, TaskSchema } from '@pipeline/core';
import { ZodError } from 'zod';
import { authenticate, authorize, requestLog, StartRequestSchema } from './security.js';
import { getClient, getRunStatus, listRuns, sendDecision, startRun } from './temporal.js';

export function createApp(cfg: AppConfig) {
  const board = createBoardProvider(cfg);
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLog);
  app.use(express.json({ limit: '128kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'agent-pipeline-api' });
  });

  app.use('/api', authenticate(cfg.api.token, cfg.api.principals), authorize('viewer'));

  app.get('/api/ready', async (_req, res, next) => {
    try {
      const client = await getClient(cfg);
      await client.connection.withDeadline(Date.now() + 3000, () =>
        client.connection.workflowService.getSystemInfo({}),
      );
      res.json({ ok: true, temporal: 'connected' });
    } catch (e) {
      next(e);
    }
  });

  /** Which integrations are live vs mocked (drives the UI mode badge). */
  app.get('/api/info', (_req, res) => {
    res.json({
      mode: cfg.llm.enabled || cfg.board.enabled || cfg.github.enabled ? 'live' : 'mock',
      integrations: {
        llm: cfg.llm.enabled ? `gemini:${cfg.llm.model}` : 'stub',
        board: cfg.board.enabled ? 'trello' : 'mock',
        github: cfg.github.enabled ? `${cfg.github.owner}/${cfg.github.repo}` : 'simulated',
      },
      maxRevisions: cfg.maxRevisions,
      access: res.locals.principal,
      execution: cfg.execution.mode,
    });
  });

  /** Inbound queue: tasks available on the board. */
  app.get('/api/board/tasks', async (_req, res, next) => {
    try {
      res.json(await board.listTasks());
    } catch (e) {
      next(e);
    }
  });

  /** Start a run from a board task id, or from a task supplied in the body. */
  app.post('/api/runs', authorize('operator'), async (req, res, next) => {
    try {
      const body = StartRequestSchema.parse(req.body);
      let task = body.task ?? null;
      if (!task && body.taskId) task = await board.getTask(String(body.taskId));
      if (!task) {
        res.status(400).json({ error: 'provide { taskId } or { task }' });
        return;
      }
      const runId = await startRun(cfg, TaskSchema.parse(task));
      res.status(201).json({ runId });
    } catch (e) {
      next(e);
    }
  });

  /** All pipeline runs (active + recent). */
  app.get('/api/runs', async (_req, res, next) => {
    try {
      res.json(await listRuns(cfg));
    } catch (e) {
      next(e);
    }
  });

  /** One run's live status. */
  app.get('/api/runs/:id', async (req, res, next) => {
    try {
      const status = await getRunStatus(cfg, req.params.id);
      if (!status) {
        res.status(404).json({ error: 'run not found' });
        return;
      }
      res.json(status);
    } catch (e) {
      next(e);
    }
  });

  /** Relay a human decision into the paused workflow (durable signal). */
  app.post('/api/runs/:id/decision', authorize('reviewer'), async (req, res, next) => {
    try {
      const decision = {
        ...DecisionSchema.parse(req.body),
        actor: res.locals.principal.id,
        at: new Date().toISOString(),
      };
      await sendDecision(cfg, String(req.params.id), decision);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  /** Server-Sent Events: poll the workflow's status and stream it to the UI. */
  app.get('/api/runs/:id/events', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let closed = false;
    req.on('close', () => {
      closed = true;
    });
    const terminal = new Set(['completed', 'failed', 'rejected']);

    while (!closed) {
      const status = await getRunStatus(cfg, req.params.id).catch(() => null);
      if (status) {
        res.write(`data: ${JSON.stringify(status)}\n\n`);
        if (terminal.has(status.state)) break;
      } else {
        res.write('event: pending\ndata: {}\n\n');
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    res.end();
  });

  // Serve the built SPA from the same origin in production (no CORS needed).
  const webDist = resolve(__dirname, '../../web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    const indexHtml = resolve(webDist, 'index.html');
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        next();
      }
    });
  }

  // Error handler.
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err instanceof ZodError || (err instanceof SyntaxError && 'body' in err)) {
        res.status(400).json({ error: 'Invalid request payload' });
        return;
      }
      if (typeof err === 'object' && err !== null && 'status' in err && err.status === 413) {
        res.status(413).json({ error: 'Request body too large' });
        return;
      }
      console.error(
        JSON.stringify({
          event: 'http.error',
          requestId: res.getHeader('X-Request-Id'),
          errorType: err instanceof Error ? err.name : 'UnknownError',
        }),
      );
      res.status(503).json({ error: 'Service temporarily unavailable' });
    },
  );

  return app;
}

if (require.main === module) {
  loadEnv();
  const cfg = loadConfig();
  const app = createApp(cfg);
  const server = app.listen(cfg.api.port, cfg.api.host, () => {
    console.log(`[api] listening on http://localhost:${cfg.api.port}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
}

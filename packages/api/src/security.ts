import { timingSafeEqual, randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { TaskSchema } from '@pipeline/core';

export const StartRequestSchema = z
  .object({
    taskId: TaskSchema.shape.id.optional(),
    task: TaskSchema.optional(),
  })
  .strict()
  .refine((v) => Number(!!v.taskId) + Number(!!v.task) === 1, 'Provide exactly one taskId or task');

export function authenticate(token?: string): RequestHandler {
  return (req, res, next) => {
    if (!token) {
      next();
      return;
    }
    const actual = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}

/** Logs only operational metadata, never payloads, URLs, tokens, or generated code. */
export const requestLog: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  const started = performance.now();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.on('finish', () =>
    console.log(
      JSON.stringify({
        event: 'http.request',
        requestId,
        method: req.method,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    ),
  );
  next();
};

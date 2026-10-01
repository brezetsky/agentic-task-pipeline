import { timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { TaskSchema, type ApiPrincipal } from '@pipeline/core';

export const StartRequestSchema = z
  .object({
    taskId: TaskSchema.shape.id.optional(),
    task: TaskSchema.optional(),
  })
  .strict()
  .refine((v) => Number(!!v.taskId) + Number(!!v.task) === 1, 'Provide exactly one taskId or task');

export function authenticate(token?: string, principals: ApiPrincipal[] = []): RequestHandler {
  return (req, res, next) => {
    if (principals.length) {
      const header = req.headers.authorization ?? '';
      const digest = createHash('sha256')
        .update(header.startsWith('Bearer ') ? header.slice(7) : '')
        .digest();
      const principal = principals.find((p) =>
        timingSafeEqual(digest, Buffer.from(p.tokenSha256, 'hex')),
      );
      if (!header.startsWith('Bearer ') || header.slice(7).length < 32 || !principal) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      res.locals.principal = { id: principal.id, roles: principal.roles };
      next();
      return;
    }
    if (!token) {
      res.locals.principal = { id: 'local-demo', roles: ['viewer', 'operator', 'reviewer'] };
      next();
      return;
    }
    const actual = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.locals.principal = { id: 'shared-token', roles: ['viewer', 'operator', 'reviewer'] };
    next();
  };
}

export function authorize(role: 'viewer' | 'operator' | 'reviewer'): RequestHandler {
  return (_req, res, next) => {
    const roles: string[] = res.locals.principal?.roles ?? [];
    // All authenticated roles may inspect the shared project; write permissions are separate.
    if (role === 'viewer' ? roles.length > 0 : roles.includes(role)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Insufficient permissions' });
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
        actor: res.locals.principal?.id,
        route: req.route?.path,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    ),
  );
  next();
};

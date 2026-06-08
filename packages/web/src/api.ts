import type { Info, RunStatus, Task } from './types';

const BASE = '/api';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const getInfo = () => fetch(`${BASE}/info`).then(json<Info>);
export const getTasks = () => fetch(`${BASE}/board/tasks`).then(json<Task[]>);
export const getRuns = () => fetch(`${BASE}/runs`).then(json<RunStatus[]>);
export const getRun = (id: string) => fetch(`${BASE}/runs/${id}`).then(json<RunStatus>);

export const startRun = (taskId: string) =>
  fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId }),
  }).then(json<{ runId: string }>);

export const sendDecision = (id: string, kind: 'approve' | 'request-changes', feedback?: string) =>
  fetch(`${BASE}/runs/${id}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, feedback }),
  }).then(json<{ ok: boolean }>);

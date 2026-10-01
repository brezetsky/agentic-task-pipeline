import type { Info, RunStatus, Task } from './types';

const BASE = '/api';
export const getToken = () => sessionStorage.getItem('pipeline-token') ?? '';
function request(url: string, init: RequestInit = {}) {
  const token = getToken();
  return fetch(url, {
    ...init,
    headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const getInfo = () => request(`${BASE}/info`).then(json<Info>);
export const getTasks = () => request(`${BASE}/board/tasks`).then(json<Task[]>);
export const getRuns = () => request(`${BASE}/runs`).then(json<RunStatus[]>);
export const getRun = (id: string) => request(`${BASE}/runs/${id}`).then(json<RunStatus>);

export const startRun = (taskId: string) =>
  request(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId }),
  }).then(json<{ runId: string }>);

export const sendDecision = (
  id: string,
  kind: 'approve' | 'request-changes',
  planRevision: number,
  feedback?: string,
) =>
  request(`${BASE}/runs/${id}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, feedback, planRevision }),
  }).then(json<{ ok: boolean }>);

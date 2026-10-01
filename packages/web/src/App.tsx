import { useCallback, useEffect, useState } from 'react';
import { getInfo, getRuns, getTasks, startRun } from './api';
import type { Info, RunStatus, Task } from './types';
import { RunDetail } from './RunDetail';

export function App() {
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<RunStatus[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const refreshRuns = useCallback(() => {
    getRuns()
      .then(setRuns)
      .catch(() => {});
  }, []);

  useEffect(() => {
    getInfo()
      .then(setInfo)
      .catch((e) => setError(e.message));
    getTasks()
      .then(setTasks)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshRuns();
    const t = setInterval(refreshRuns, 3000);
    return () => clearInterval(t);
  }, [refreshRuns]);

  const onStart = async (taskId: string) => {
    setStarting(taskId);
    try {
      const { runId } = await startRun(taskId);
      setSelected(runId);
      refreshRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start run');
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Agent Pipeline</h1>
          <div className="tagline">
            board → analyze → plan → <strong>human approves</strong> → implement → test → PR
          </div>
        </div>
        {info && (
          <span className={`mode ${info.mode}`}>{info.mode === 'live' ? 'LIVE' : 'MOCK MODE'}</span>
        )}
      </header>

      {error && (
        <section role="alert">
          <p>{error}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sessionStorage.setItem('pipeline-token', token);
              window.location.reload();
            }}
          >
            <label>
              API access token{' '}
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <button type="submit">Connect</button>
          </form>
        </section>
      )}
      {info && (
        <div className="integrations">
          <span>
            Access{' '}
            <code>
              {info.access.id}: {info.access.roles.join(', ')}
            </code>
          </span>
          <span>
            Execution <code>{info.execution}</code>
          </span>
          <span>
            LLM <code>{info.integrations.llm}</code>
          </span>
          <span>
            Board <code>{info.integrations.board}</code>
          </span>
          <span>
            GitHub <code>{info.integrations.github}</code>
          </span>
        </div>
      )}

      <div className="cols">
        <aside>
          <section>
            <h2>Inbound tasks</h2>
            {tasks.map((t) => (
              <div className="task-card" key={t.id}>
                <div className="task-title">{t.title}</div>
                <div className="task-desc">{t.description}</div>
                <button
                  disabled={starting === t.id || !info?.access.roles.includes('operator')}
                  onClick={() => onStart(t.id)}
                >
                  {starting === t.id ? 'Starting…' : 'Start run →'}
                </button>
              </div>
            ))}
          </section>

          <section>
            <h2>Runs</h2>
            {runs.length === 0 && <div className="muted">No runs yet.</div>}
            {runs.map((r) => (
              <button
                key={r.runId}
                className={`run-item ${selected === r.runId ? 'active' : ''}`}
                onClick={() => setSelected(r.runId)}
              >
                <span className={`state ${r.state}`}>{r.state}</span>
                <span className="run-title">{r.task.title}</span>
              </button>
            ))}
          </section>
        </aside>

        <main>
          {selected ? (
            <RunDetail
              runId={selected}
              onChange={refreshRuns}
              canReview={info?.access.roles.includes('reviewer') ?? false}
            />
          ) : (
            <div className="empty">
              Pick an inbound task and press “Start run”, then approve its plan here.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

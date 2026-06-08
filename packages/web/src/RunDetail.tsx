import { useEffect, useState } from 'react';
import { getRun, sendDecision } from './api';
import type { RunStatus } from './types';

/**
 * Live run view. Subscribes to the SSE stream and also polls as a safety net
 * (so it stays live even if a dev proxy buffers the stream).
 */
export function RunDetail({ runId, onChange }: { runId: string; onChange: () => void }) {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(null);
    let alive = true;
    const es = new EventSource(`/api/runs/${runId}/events`);
    es.onmessage = (e) => {
      if (!e.data || e.data === '{}') return;
      try {
        setStatus(JSON.parse(e.data) as RunStatus);
      } catch {
        /* ignore */
      }
    };
    const poll = setInterval(() => {
      getRun(runId)
        .then((s) => alive && setStatus(s))
        .catch(() => {});
    }, 2000);
    return () => {
      alive = false;
      es.close();
      clearInterval(poll);
    };
  }, [runId]);

  const decide = async (kind: 'approve' | 'request-changes') => {
    setBusy(true);
    try {
      await sendDecision(runId, kind, kind === 'request-changes' ? feedback : undefined);
      setFeedback('');
      onChange();
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <div className="empty">Connecting to {runId}…</div>;
  const awaiting = status.state === 'awaiting-approval';

  return (
    <div className="detail">
      <div className="detail-head">
        <h2>{status.task.title}</h2>
        <span className={`state ${status.state}`}>{status.state}</span>
      </div>
      <div className="muted mono">
        {runId} · revisions: {status.revisions}
        {status.branch ? ` · branch: ${status.branch}` : ''}
      </div>

      {status.analysis && (
        <section>
          <h3>Analysis</h3>
          <p>{status.analysis.summary}</p>
          {status.analysis.risks.length > 0 && (
            <ul className="risks">
              {status.analysis.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {status.plan && (
        <section>
          <h3>Proposed plan</h3>
          <p>{status.plan.summary}</p>
          <ol className="steps">
            {status.plan.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <h4>File edits ({status.plan.edits.length})</h4>
          {status.plan.edits.map((e, i) => (
            <details key={i} className="edit">
              <summary>
                <span className={`tag ${e.action}`}>{e.action}</span> <code>{e.path}</code>
              </summary>
              {e.contents && <pre>{e.contents}</pre>}
            </details>
          ))}
          <div className="muted">
            test command: <code>{status.plan.testCommand}</code>
          </div>
        </section>
      )}

      {awaiting && (
        <section className="approve-box">
          <h3>Your decision</h3>
          <textarea
            placeholder="Optional feedback (sent with Request changes)…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="actions">
            <button className="approve-btn" disabled={busy} onClick={() => decide('approve')}>
              Approve
            </button>
            <button className="changes-btn" disabled={busy} onClick={() => decide('request-changes')}>
              Request changes
            </button>
          </div>
        </section>
      )}

      {status.prUrl && (
        <section>
          <h3>Pull request</h3>
          <a href={status.prUrl} target="_blank" rel="noreferrer">
            {status.prUrl}
          </a>
          {status.testsPassed != null && <> · tests {status.testsPassed ? 'passed ✅' : 'failed ❌'}</>}
        </section>
      )}

      {status.error && (
        <section>
          <h3>Error</h3>
          <pre className="error">{status.error}</pre>
        </section>
      )}

      <section>
        <h3>History</h3>
        <ol className="history">
          {status.history.map((h, i) => (
            <li key={i}>
              <span className={`dot ${h.state}`} />
              <span className="hstate">{h.state}</span>
              {h.note ? <span className="hnote"> — {h.note}</span> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

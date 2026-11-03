import React from 'react';
import { formatTime, humanize } from '../../lib/format';
import { actorLabel, toRecall } from '../../lib/trace';
import type { TraceEvent } from '../../types';

export const MemoryRecalled: React.FC<{ trace: TraceEvent[]; model: string | null }> = ({ trace, model }) => {
  const recalls = trace.filter((t) => t.kind === 'recall').map(toRecall);
  return (
    <section className="panel" aria-label="Collaborative memory">
      <div className="panel-head">
        <h3 className="panel-title">Collaborative memory</h3>
        {model && <span className="attribution">Retrieved by {model}</span>}
      </div>
      <p className="muted small">Plant memory, procedures and past incidents the investigator pulled in, with the record each came from.</p>
      {recalls.length === 0 ? (
        <p className="muted">Nothing recalled yet.</p>
      ) : (
        <ul className="recall-list">
          {recalls.map((r) => (
            <li key={r.seq} className={r.error ? 'is-error' : ''}>
              <span className="recall-kind">{r.label}</span>
              {r.source && <code className="tag">{r.source}</code>}
              <span className="recall-title">{r.error ? `No match: ${r.error}` : (r.title ?? '')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

interface TraceProps {
  trace: TraceEvent[];
  investigatorModel: string | null;
  watcherModel: string | null;
}

export const AuditTrail: React.FC<TraceProps> = ({ trace, investigatorModel, watcherModel }) => {
  const models = { investigator: investigatorModel, watcher: watcherModel };
  return (
    <section className="panel" aria-label="Audit trail">
      <div className="panel-head">
        <h3 className="panel-title">Audit trail</h3>
        <span className="count">{trace.length} events, newest first</span>
      </div>
      {trace.length === 0 ? (
        <p className="muted">No events recorded yet.</p>
      ) : (
        <ol className="trace">
          {[...trace].reverse().map((t) => (
            <li key={t.seq} className={`trace-item actor-${t.actor}`}>
              <time>{formatTime(t.at)}</time>
              <div className="trace-body">
                <div className="trace-meta">
                  <span className="trace-actor">{actorLabel(t, models)}</span>
                  <span className="trace-kind">{humanize(t.kind)}</span>
                </div>
                {t.content.length > 220 ? (
                  <details>
                    <summary>{t.content.slice(0, 200)}...</summary>
                    <p className="trace-full">{t.content}</p>
                  </details>
                ) : (
                  <p>{t.content}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

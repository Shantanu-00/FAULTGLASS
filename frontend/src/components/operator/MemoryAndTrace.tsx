import React, { useEffect, useRef } from 'react';
import { formatTime, humanize } from '../../lib/format';
import { actorLabel, toRecall } from '../../lib/trace';
import type { TraceEvent } from '../../types';

export const MemoryRecalled: React.FC<{ trace: TraceEvent[]; model: string | null }> = ({ trace, model }) => {
  const recalls = trace.filter((t) => t.kind === 'recall').map(toRecall);
  return (
    <section className="panel stack-card" aria-label="Memory recalls">
      <div className="panel-head">
        <h3 className="panel-title">Memory recalls</h3>
        <span className="count">{recalls.length}</span>
      </div>
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
      <p className="attribution">{model ? `Retrieved by ${model}` : 'Retrieved by the investigator'}, from plant memory, procedures and past incidents.</p>
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
  const list = useRef<HTMLOListElement | null>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [trace.length]);

  return (
    <section className="panel stack-card" aria-label="Audit trail">
      <div className="panel-head">
        <h3 className="panel-title">Tool-call and audit trail</h3>
        <span className="count">{trace.length} events</span>
      </div>
      {trace.length === 0 ? (
        <p className="muted">No events recorded yet.</p>
      ) : (
        <ol
          className="trace"
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
          }}
        >
          {trace.map((t) => (
            <li key={t.seq} className={`trace-item actor-${t.actor}`}>
              <time>{formatTime(t.at)}</time>
              <div className="trace-body">
                <span className="trace-actor">{actorLabel(t, models)}</span> <span className="trace-kind">{humanize(t.kind)}</span>
                {t.content.length > 150 ? (
                  <details>
                    <summary>{t.content.slice(0, 130)}...</summary>
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

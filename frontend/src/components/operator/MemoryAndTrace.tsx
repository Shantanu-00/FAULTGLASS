import React from 'react';
import { formatTime, humanize } from '../../lib/format';
import { actorLabel, toRecall } from '../../lib/trace';
import type { TraceEvent } from '../../types';

export const MemoryRecalled: React.FC<{ trace: TraceEvent[]; model: string | null }> = ({ trace, model }) => {
  const recalls = trace.filter((entry) => entry.kind === 'recall').map(toRecall);
  return <section className="investigation-card" aria-label="Sources consulted">
    <div className="investigation-card-head"><h3>Sources consulted</h3><span className="investigation-meta">{recalls.length}</span></div>
    {recalls.length === 0 ? <p className="investigation-meta">No sources have been retrieved yet.</p> : <ul className="investigation-source-list">{recalls.map((recall) => <li key={recall.seq}>
      <span className="investigation-meta-label">{recall.label}</span><span>{recall.error ? `No match: ${recall.error}` : recall.title || recall.source || 'Source retrieved'}</span>
      {recall.source && recall.title && <code>{recall.source}</code>}
    </li>)}</ul>}
    <p className="investigation-meta">Retrieved by {model || 'Wonder'} from plant memory, procedures and past incidents.</p>
  </section>;
};
interface TraceProps { trace: TraceEvent[]; investigatorModel: string | null; watcherModel: string | null }
export const AuditTrail: React.FC<TraceProps> = ({ trace, investigatorModel, watcherModel }) => {
  const models = { investigator: investigatorModel, watcher: watcherModel };
  const actor = (entry: TraceEvent) => entry.actor === 'model' ? entry.tool_name === 'spark_watcher' || entry.kind === 'alarm' ? 'Spark' : 'Wonder' : entry.actor === 'operator' ? 'Command / Field' : entry.actor === 'verifier' ? 'Verifier' : entry.actor === 'code' ? 'Validation' : 'System';
  return <section className="investigation-card" aria-label="Activity and audit record">
    <div className="investigation-card-head"><h3>Activity</h3><span className="investigation-meta">{trace.length} events</span></div>
    {trace.length === 0 ? <p className="investigation-meta">No activity recorded yet.</p> : <ol className="investigation-activity">{[...trace].sort((a, b) => b.seq - a.seq).map((entry) => <li key={entry.seq}>
      <div className="activity-heading"><strong>{actor(entry)}</strong><time dateTime={entry.at}>{formatTime(entry.at)}</time></div>
      <details><summary>{humanize(entry.tool_name || entry.kind)}</summary><p className="activity-content">{entry.content}</p><p className="investigation-meta">Recorded by {actorLabel(entry, models)}</p></details>
    </li>)}</ol>}
  </section>;
};

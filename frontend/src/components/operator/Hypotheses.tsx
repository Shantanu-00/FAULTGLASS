import React from 'react';
import { humanize } from '../../lib/format';
import type { Hypothesis } from '../../types';
import { Pill, type Tone } from '../common/Pill';
const TONE: Record<Hypothesis['status'], Tone> = { open: 'neutral', supported: 'accent', confirmed: 'ok', rejected: 'neutral' };
const evidenceText = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);
interface Props { items: Hypothesis[]; model: string | null; title?: string; compact?: boolean }
export const Hypotheses: React.FC<Props> = ({ items, model, title = 'Hypotheses', compact }) => (
  <section className="investigation-card findings-card" aria-label={title}>
    <div className="investigation-card-head"><span className="investigation-eyebrow">Wonder · {title}</span>{!compact && <span className="investigation-meta">{items.length} recorded</span>}</div>
    {items.length === 0 ? <p className="investigation-meta">No hypotheses recorded yet.</p> : <ul className="finding-list">{items.map((hypothesis) => <li className={`finding finding-${hypothesis.status}`} key={hypothesis.label}>
      <div className="finding-status"><Pill tone={TONE[hypothesis.status]}>{hypothesis.status === 'open' ? 'Under review' : humanize(hypothesis.status)}</Pill>{!compact && <code>{hypothesis.label}</code>}</div>
      <h3>{hypothesis.statement}</h3>
      {hypothesis.evidence_for.length > 0 && <div className="finding-evidence"><span className="investigation-meta-label">Supporting evidence</span><ul>{hypothesis.evidence_for.slice(0, compact ? 3 : undefined).map((entry, index) => <li key={index}>{evidenceText(entry)}</li>)}</ul></div>}
      {hypothesis.evidence_against.length > 0 && <div className="finding-evidence"><span className="investigation-meta-label">{hypothesis.status === 'rejected' ? 'Ruled out because' : 'Unresolved evidence'}</span><ul>{hypothesis.evidence_against.slice(0, compact ? 2 : undefined).map((entry, index) => <li key={index}>{evidenceText(entry)}</li>)}</ul></div>}
      {compact && (hypothesis.evidence_for.length > 3 || hypothesis.evidence_against.length > 2) && <p className="investigation-meta">The full evidence is available in Investigation history.</p>}
    </li>)}</ul>}
    {!compact && model && <p className="investigation-meta">Recorded by {model}</p>}
  </section>
);

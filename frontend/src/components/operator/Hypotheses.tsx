import React from 'react';
import { formatTime } from '../../lib/format';
import type { Hypothesis } from '../../types';
import { Pill, type Tone } from '../common/Pill';
const STATUS: Record<Hypothesis['status'], { label: string; tone: Tone }> = {
  open: { label: 'Under review', tone: 'neutral' }, supported: { label: 'Supported', tone: 'accent' },
  confirmed: { label: 'Confirmed', tone: 'ok' }, rejected: { label: 'Ruled out', tone: 'neutral' },
};
const ORDER: Record<Hypothesis['status'], number> = { confirmed: 0, supported: 1, open: 2, rejected: 3 };
const evidenceText = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);
interface Props { items: Hypothesis[]; model: string | null; title?: string; compact?: boolean }
export const Hypotheses: React.FC<Props> = ({ items, model, title = 'Hypothesis board', compact }) => {
  const ordered = [...items].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.label.localeCompare(b.label, undefined, { numeric: true }));
  const supported = items.filter((item) => item.status === 'supported' || item.status === 'confirmed').length;
  const rejected = items.filter((item) => item.status === 'rejected').length;
  return <section id="hypothesis-board" className="investigation-card hypothesis-board" aria-label={title}>
    <div className="investigation-card-head">
      <div><span className="investigation-eyebrow">Muse Wonder · diagnosis</span><h3>{title}</h3></div>
      <span className="hypothesis-total">{items.length}<small> recorded</small></span>
    </div>
    {items.length > 0 && <div className="hypothesis-key" aria-label="Hypothesis summary">
      <span><i className="hypothesis-dot is-supported" />{supported} supported</span>
      <span><i className="hypothesis-dot is-open" />{items.length - supported - rejected} under review</span>
      <span><i className="hypothesis-dot is-rejected" />{rejected} ruled out</span>
    </div>}
    {items.length === 0 ? <div className="hypothesis-empty"><span className="hypothesis-empty-mark" aria-hidden="true">H—</span><p>Hypotheses will appear as Wonder records possible causes and checks the evidence.</p></div> : <ol className="finding-list">{ordered.map((hypothesis) => {
      const status = STATUS[hypothesis.status];
      const primary = hypothesis.status === 'rejected' ? hypothesis.evidence_against : hypothesis.evidence_for;
      const secondary = hypothesis.status === 'rejected' ? hypothesis.evidence_for : hypothesis.evidence_against;
      const shown = 1;
      return <li className={`finding finding-${hypothesis.status}`} key={hypothesis.label}>
        <div className="finding-heading"><span className="hypothesis-id">{hypothesis.label}</span><Pill tone={status.tone}>{status.label}</Pill></div>
        <h4>{hypothesis.statement}</h4>
        {primary.length > 0 ? <div className="finding-evidence">
          <span className="investigation-meta-label">{hypothesis.status === 'rejected' ? 'Why it was ruled out' : 'Evidence supporting this cause'}</span>
          <ul>{primary.slice(0, shown).map((entry, index) => <li key={index}>{evidenceText(entry)}</li>)}</ul>
        </div> : <p className="finding-pending">{hypothesis.status === 'rejected' ? 'No rejection evidence was recorded.' : 'Supporting evidence has not been recorded yet.'}</p>}
        {(primary.length > shown || secondary.length > 0) && <details className="investigation-inline-details finding-more"><summary>All recorded evidence{secondary.length > 0 ? ` · ${secondary.length} ${hypothesis.status === 'rejected' ? 'earlier supporting' : 'opposing'}` : ''}</summary>
          {hypothesis.evidence_for.length > 0 && <div className="finding-evidence"><span className="investigation-meta-label">Supporting evidence</span><ul>{hypothesis.evidence_for.map((entry, index) => <li key={index}>{evidenceText(entry)}</li>)}</ul></div>}
          {hypothesis.evidence_against.length > 0 && <div className="finding-evidence"><span className="investigation-meta-label">Evidence against</span><ul>{hypothesis.evidence_against.map((entry, index) => <li key={index}>{evidenceText(entry)}</li>)}</ul></div>}
        </details>}
        <time className="finding-updated" dateTime={hypothesis.updated_at}>Updated {formatTime(hypothesis.updated_at)}</time>
      </li>;
    })}</ol>}
    {model && <details className="investigation-inline-details hypothesis-source"><summary>Model & record source</summary><p className="investigation-meta">{model} · saved hypothesis records from this incident.</p></details>}
  </section>;
};

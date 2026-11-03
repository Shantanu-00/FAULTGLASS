import React from 'react';
import { humanize } from '../../lib/format';
import type { Hypothesis } from '../../types';
import { Pill, type Tone } from '../common/Pill';

const TONE: Record<Hypothesis['status'], Tone> = { open: 'neutral', supported: 'accent', confirmed: 'ok', rejected: 'neutral' };
const text = (e: unknown) => (typeof e === 'string' ? e : JSON.stringify(e));

export const Hypotheses: React.FC<{ items: Hypothesis[]; model: string | null }> = ({ items, model }) => {
  const rejected = items.filter((h) => h.status === 'rejected').length;
  return (
    <section className="panel stack-card" aria-label="Hypotheses">
      <div className="panel-head">
        <h3 className="panel-title">Hypotheses</h3>
        <span className="count">
          {items.length} total{rejected ? `, ${rejected} rejected` : ''}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="muted">No hypotheses recorded yet.</p>
      ) : (
        <ul className="hyp-list">
          {items.map((h) => (
            <li className={`hyp hyp-${h.status}`} key={h.label}>
              <div className="hyp-head">
                <code className="tag">{h.label}</code>
                <p className="hyp-statement">{h.statement}</p>
                <Pill tone={TONE[h.status]}>{humanize(h.status)}</Pill>
              </div>
              {h.evidence_against.length > 0 && (
                <div className="evidence against">
                  <span className="evidence-head">{h.status === 'rejected' ? 'Rejected because' : 'Against'}</span>
                  <ul>
                    {h.evidence_against.map((e, i) => (
                      <li key={i}>{text(e)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {h.evidence_for.length > 0 && (
                <div className="evidence for">
                  <span className="evidence-head">Supporting evidence</span>
                  <ul>
                    {h.evidence_for.map((e, i) => (
                      <li key={i}>{text(e)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="attribution">{model ? `Recorded by ${model}` : 'Recorded by the investigator'}</p>
    </section>
  );
};

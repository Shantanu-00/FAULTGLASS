import React from 'react';
import { humanize } from '../../lib/format';
import type { Hypothesis } from '../../types';
import { Pill, type Tone } from '../common/Pill';

const TONE: Record<Hypothesis['status'], Tone> = { open: 'neutral', supported: 'accent', confirmed: 'ok', rejected: 'neutral' };

export const Hypotheses: React.FC<{ items: Hypothesis[]; model: string | null }> = ({ items, model }) => (
  <section className="panel" aria-label="Hypotheses">
    <div className="panel-head">
      <h3 className="panel-title">Hypotheses</h3>
      {model && <span className="attribution">Recorded by {model}</span>}
    </div>
    {items.length === 0 ? (
      <p className="muted">No hypotheses recorded yet.</p>
    ) : (
      <ul className="hyp-list">
        {items.map((h) => (
          <li className={`hyp hyp-${h.status}`} key={h.label}>
            <div className="hyp-head">
              <code className="tag">{h.label}</code>
              <Pill tone={TONE[h.status]}>{humanize(h.status)}</Pill>
            </div>
            <p className="hyp-statement">{h.statement}</p>
            {(h.evidence_for.length > 0 || h.evidence_against.length > 0) && (
              <ul className="evidence">
                {h.evidence_against.map((e, i) => (
                  <li className="against" key={`a${i}`}>
                    <span className="evidence-mark" aria-label="Evidence against">-</span> {String(e)}
                  </li>
                ))}
                {h.evidence_for.map((e, i) => (
                  <li className="for" key={`f${i}`}>
                    <span className="evidence-mark" aria-label="Evidence for">+</span> {String(e)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    )}
  </section>
);

import React from 'react';
import { usePlant } from '../../context/PlantContext';

export const HypothesisTree: React.FC = () => {
  const { activeIncident } = usePlant();
  const hypotheses = activeIncident?.hypotheses || [];

  return (
    <div className="reasoning-card">
      <div className="reasoning-card-header">
        <span>HYPOTHESIS TREE · DIAGNOSIS</span>
        <span className="chip">EVIDENCE UPDATED</span>
      </div>

      {hypotheses.length === 0 ? (
        <p className="muted" style={{ margin: '8px 0', fontSize: 12 }}>
          No live incident. Competing hypotheses will form when drift is flagged.
        </p>
      ) : (
        <div className="htree">
          {hypotheses.map((h) => {
            const isWinner = h.status === 'confirmed' || h.status === 'supported';
            const isKilled = h.status === 'rejected';

            return (
              <div
                key={h.id}
                className={`hnode ${h.status}`}
                style={{
                  borderLeftColor: isWinner ? '#15803D' : isKilled ? '#9CA3AF' : '#2563EB',
                }}
              >
                <div className="hhead">
                  <code>{h.label}</code>
                  <span
                    className="hstatus"
                    style={{
                      color: isWinner ? '#15803D' : isKilled ? '#6B7280' : '#2563EB',
                      fontWeight: 800,
                    }}
                  >
                    {h.probability}% · {h.status.toUpperCase()}
                  </span>
                </div>

                <div
                  style={{
                    height: 5,
                    background: '#E5E7EB',
                    borderRadius: 2,
                    margin: '6px 0',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${h.probability}%`,
                      background: isWinner ? '#15803D' : isKilled ? '#9CA3AF' : '#E05326',
                      transition: 'width 0.6s ease',
                    }}
                  />
                </div>

                <p style={{ margin: '4px 0', fontWeight: 600 }}>{h.statement}</p>

                {h.evidence_for && h.evidence_for.length > 0 && (
                  <ul className="hev">
                    {h.evidence_for.map((ev, i) => (
                      <li key={i} className="for">
                        + {ev}
                      </li>
                    ))}
                  </ul>
                )}

                {h.evidence_against && h.evidence_against.length > 0 && (
                  <ul className="hev">
                    {h.evidence_against.map((ev, i) => (
                      <li key={i} className="against">
                        − {ev}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

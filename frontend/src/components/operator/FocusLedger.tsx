import React from 'react';
import type { Focus } from '../../types';

export const FocusLedger: React.FC<{ focus: Focus | undefined; model: string | null }> = ({ focus, model }) => {
  const has = focus && (focus.goal || focus.blocker || focus.next_step || focus.focus_assets?.length);
  return (
    <section className="panel" aria-label="Focus ledger">
      <div className="panel-head">
        <h3 className="panel-title">Focus ledger</h3>
        {model && <span className="attribution">Written by {model}</span>}
      </div>
      {!has ? (
        <p className="muted">The investigator has not recorded a focus yet.</p>
      ) : (
        <dl className="kv kv-wide">
          <dt>Goal</dt>
          <dd>{focus.goal || '-'}</dd>
          <dt>Blocker</dt>
          <dd>{focus.blocker || 'None recorded'}</dd>
          <dt>Next step</dt>
          <dd>{focus.next_step || '-'}</dd>
          <dt>In focus</dt>
          <dd>
            {focus.focus_assets?.length ? (
              <span className="chips">
                {focus.focus_assets.map((asset) => (
                  <code className="tag" key={asset}>
                    {asset}
                  </code>
                ))}
              </span>
            ) : (
              '-'
            )}
          </dd>
        </dl>
      )}
    </section>
  );
};

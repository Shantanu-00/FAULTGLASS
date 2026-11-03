import React from 'react';
import { humanize } from '../../lib/format';
import type { Focus } from '../../types';
import { Pill } from '../common/Pill';

const STATUS_TEXT: Record<string, string> = {
  not_started: 'Not started',
  investigating: 'Investigating',
  waiting_field: 'Waiting for field evidence',
  awaiting_approval: 'Waiting for your approval',
  concluded: 'Concluded, awaiting verification',
  escalated: 'Escalated to a human',
};

interface Props {
  focus: Focus | undefined;
  model: string | null;
  status: string;
  steps: number;
}

export const FocusLedger: React.FC<Props> = ({ focus, model, status, steps }) => {
  const has = focus && (focus.goal || focus.blocker || focus.next_step || focus.focus_assets?.length);
  return (
    <section className="panel stack-card" aria-label="Focus ledger">
      <div className="panel-head">
        <h3 className="panel-title">Wonder focus ledger</h3>
        <Pill tone={status === 'escalated' ? 'alarm' : 'accent'}>{STATUS_TEXT[status] ?? humanize(status)}</Pill>
      </div>
      {!has ? (
        <p className="muted">No focus recorded yet.</p>
      ) : (
        <dl className="kv">
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
      <p className="attribution">
        {model ? `Written by ${model}` : 'Written by the investigator'} - {steps} step{steps === 1 ? '' : 's'} used
      </p>
    </section>
  );
};

import React from 'react';
import { humanize } from '../../lib/format';
import type { Focus } from '../../types';
import { Pill } from '../common/Pill';
const STATUS_TEXT: Record<string, string> = {
  not_started: 'Preparing', investigating: 'Investigating', waiting_field: 'Awaiting evidence',
  awaiting_approval: 'Awaiting approval', concluded: 'Findings recorded', escalated: 'Human review',
};
interface Props { focus: Focus | undefined; model: string | null; status: string; steps: number }
export const FocusLedger: React.FC<Props> = ({ focus, model, status, steps }) => {
  const blocker = focus?.blocker?.trim();
  const hasBlocker = blocker && !/^(none|none recorded|no blockers?|n\/a)[.!]?$/i.test(blocker);
  return <section className="investigation-card investigation-plan" aria-label="Investigation plan">
    <div className="investigation-card-head"><span className="investigation-eyebrow">Wonder · investigation plan</span><Pill tone={status === 'escalated' ? 'warning' : 'neutral'}>{STATUS_TEXT[status] ?? humanize(status)}</Pill></div>
    <h3>Next step</h3><p>{focus?.next_step || (status === 'concluded' ? 'No further step has been recorded. Review the findings and activity.' : 'Wonder is reviewing the available plant evidence.')}</p>
    {hasBlocker && <p className="investigation-blocker"><strong>Needs attention</strong> {blocker}</p>}
    {focus?.focus_assets?.length ? <div className="investigation-tags">{focus.focus_assets.map((asset) => <code key={asset}>{asset}</code>)}</div> : null}
    <details className="investigation-inline-details"><summary>Investigation context</summary>
      {focus?.goal && <p>{focus.goal}</p>}<p className="investigation-meta">{model || 'Wonder'} · {steps} investigation step{steps === 1 ? '' : 's'}</p>
    </details>
  </section>;
};

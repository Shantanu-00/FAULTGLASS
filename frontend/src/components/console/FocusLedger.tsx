import React from 'react';
import { usePlant } from '../../context/PlantContext';

export const FocusLedger: React.FC = () => {
  const { activeIncident } = usePlant();
  const focus = activeIncident?.investigation?.focus;

  return (
    <div className="reasoning-card">
      <div className="reasoning-card-header">
        <span>WHY THIS TASK NOW</span>
        <span className="chip info">ACTIVE FOCUS</span>
      </div>
      <dl className="focus">
        <dt>Goal</dt>
        <dd>{focus?.goal || 'Monitoring plant output baseline. Ready to open incident upon drift flag.'}</dd>

        <dt>Blocker</dt>
        <dd>{focus?.blocker || 'None · All digital channels within tolerance'}</dd>

        <dt>Next step</dt>
        <dd>{focus?.next_step || 'Routine baseline observation'}</dd>

        <dt>In focus</dt>
        <dd>
          {focus?.focus_assets?.length
            ? focus.focus_assets.map((a) => (
                <code key={a} style={{ marginRight: 6 }}>
                  {a}
                </code>
              ))
            : 'Plant-wide'}
        </dd>
      </dl>
    </div>
  );
};

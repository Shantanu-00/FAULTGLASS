import React from 'react';
import type { Stage } from '../../lib/stages';
import { Icon } from '../common/Icon';

export const StageRibbon: React.FC<{ stages: Stage[] }> = ({ stages }) => (
  <ol className="ribbon" aria-label="Incident progress">
    {stages.map((stage, index) => (
      <li key={stage.id} className={`ribbon-step is-${stage.state}`} aria-current={stage.state === 'current' ? 'step' : undefined}>
        <span className="ribbon-mark" aria-hidden="true">
          {stage.state === 'done' ? <Icon name="check" size={14} /> : stage.state === 'skipped' ? '-' : index + 1}
        </span>
        <span className="ribbon-text">
          <span className="ribbon-label">{stage.label}</span>
          <span className="ribbon-detail">{stage.detail}</span>
        </span>
      </li>
    ))}
  </ol>
);

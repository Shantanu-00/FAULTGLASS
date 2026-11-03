import React from 'react';
import type { TwinTargets } from '../../lib/twinTargets';

export const TwinLegend: React.FC<{ targets: TwinTargets; hasFlag: boolean }> = ({ targets, hasFlag }) => (
  <div className="twin-legend" aria-label="Highlight legend">
    {targets.groups.length === 0 ? (
      <p className="legend-empty">Nothing highlighted yet.</p>
    ) : (
      targets.groups.map((group) => (
        <div className="legend-row" key={group.role}>
          <span className={`ring-swatch ring-${group.role === 'focus' ? 'focus' : 'task'}`} aria-hidden="true" />
          <span className="legend-label">{group.label}</span>
          <span className="chips">
            {group.codes.map((code) => (
              <code className="tag" key={code}>
                {code}
              </code>
            ))}
          </span>
        </div>
      ))
    )}
    {hasFlag && (
      <div className="legend-row">
        <span className="ring-swatch ring-warning" aria-hidden="true" />
        <span className="legend-label">Flagged signal</span>
      </div>
    )}
  </div>
);

import React from 'react';
import { usePlant } from '../../state/PlantContext';
import { VIEWS, type View } from '../../state/route';
import { Icon } from './Icon';

const VIEW_ICON = { operator: 'operator', field: 'field', twin: 'twin' } as const;

interface Props {
  view: View;
  onNavigate: (view: View) => void;
}

export const AppHeader: React.FC<Props> = ({ view, onNavigate }) => {
  const { plant, connection, run } = usePlant();

  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-text">
          <span className="brand-name">Faultglass<span className="brand-period">.</span></span>
          <span className="brand-plant">Plant incident command</span>
        </div>
      </div>

      <nav className="view-nav" aria-label="Views">
        {VIEWS.map((v) => (
          <a
            key={v.id}
            href={`?view=${v.id}`}
            className={`view-link${view === v.id ? ' is-current' : ''}`}
            aria-current={view === v.id ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(v.id);
            }}
          >
            <Icon name={VIEW_ICON[v.id]} size={18} />
            <span>{v.label}</span>
          </a>
        ))}
      </nav>

      <div className="header-status">
        {plant?.simulation && (
          <span className="simulation-label" title="Plant telemetry is simulated. Field evidence is collected separately.">
            <span className="simulation-dot" aria-hidden="true" />
            Simulated{run ? <span className="simulation-speed"> · {run.clock_speed}× clock</span> : ''}
          </span>
        )}
        <span className={`conn conn-${connection}`}>
          <span className="conn-dot" aria-hidden="true" />
          {connection === 'online' ? 'Connected' : connection === 'offline' ? 'API unreachable' : 'Connecting'}
        </span>
      </div>
    </header>
  );
};

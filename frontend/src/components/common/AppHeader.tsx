import React from 'react';
import { usePlant } from '../../state/PlantContext';
import { VIEWS, type View } from '../../state/route';
import { Icon } from './Icon';
import { Pill } from './Pill';

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
        <svg className="brand-mark" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <rect width="26" height="26" rx="6" fill="var(--accent)" />
          <path d="M8 7h10M8 7v12M8 13h7" stroke="#fff" strokeWidth="2.4" strokeLinecap="square" fill="none" />
        </svg>
        <div className="brand-text">
          <span className="brand-name">FAULTGLASS</span>
          {plant && <span className="brand-plant">{plant.name}</span>}
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
        {plant?.simulation && <Pill tone="warning">Simulated</Pill>}
        {plant?.simulation && run && (
          <span className="chip" title="Each real second advances the plant simulation by this many simulated seconds">
            Simulated clock {run.clock_speed}x
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

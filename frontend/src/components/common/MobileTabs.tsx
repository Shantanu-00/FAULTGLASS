import React from 'react';
import { VIEWS, type View } from '../../state/route';
import { Icon } from './Icon';

const VIEW_ICON = { operator: 'operator', field: 'field', twin: 'twin' } as const;

export const MobileTabs: React.FC<{ view: View; onNavigate: (view: View) => void }> = ({ view, onNavigate }) => (
  <nav className="mobile-tabs" aria-label="Views">
    {VIEWS.map((v) => (
      <button
        key={v.id}
        type="button"
        className={`mobile-tab${view === v.id ? ' is-current' : ''}`}
        aria-current={view === v.id ? 'page' : undefined}
        onClick={() => onNavigate(v.id)}
      >
        <Icon name={VIEW_ICON[v.id]} size={22} />
        <span>{v.label}</span>
      </button>
    ))}
  </nav>
);

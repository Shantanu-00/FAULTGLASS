import React, { useEffect, useRef } from 'react';
import { usePlant } from '../../state/PlantContext';
import { Icon } from '../common/Icon';

export const ActionBar: React.FC = () => {
  const { plant, run, runLoaded, connection, injectBlockage, resetRun, recordBackwash, busy } = usePlant();
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  if (!plant?.simulation) return null;
  const ready = connection === 'online' && runLoaded && run?.status === 'running';
  const learning = run?.status === 'starting' || run?.status === 'learning';

  return (
    <details className="command-demo" ref={menu}>
      <summary className="command-tool">Demo controls<span className="disclosure-chevron" aria-hidden="true" /></summary>
      <div className="command-demo-menu">
        <div className="command-demo-heading">Plant simulator</div>
        <p>{learning ? 'Learning the normal production baseline. The scenario is available when learning completes.' : run?.scenario ? 'A production decline is active. Reset to begin a new run.' : 'Start a simulated production decline, then follow the live investigation.'}</p>
        <button className="btn btn-primary" type="button" disabled={!ready || Boolean(run?.scenario) || busy.inject || busy.reset} onClick={() => void injectBlockage()}>
          <Icon name="alert" size={16} />{busy.inject ? 'Starting decline…' : 'Start production decline'}
        </button>
        <button className="btn" type="button" disabled={connection !== 'online' || !runLoaded || busy.reset || busy.inject} onClick={() => void resetRun()}>
          <Icon name="refresh" size={16} />{busy.reset ? 'Resetting…' : 'Reset simulation'}
        </button>
        <details className="command-simulator-utility">
          <summary>Simulator utilities</summary>
          <p>Record the recovery event directly for setup. The worker workflow records this only after the valve evidence passes.</p>
          <button className="btn btn-small" type="button" disabled={!ready || !run?.scenario} onClick={() => void recordBackwash()}>Record backwash complete</button>
        </details>
      </div>
    </details>
  );
};

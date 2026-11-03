import React from 'react';
import { formatTime, humanize } from '../../lib/format';
import { usePlant } from '../../state/PlantContext';
import { Pill, type Tone } from '../common/Pill';

const STATUS_TEXT: Record<string, string> = {
  starting: 'Starting',
  learning: 'Learning baseline',
  running: 'Running',
  stopped: 'Stopped',
};

export const RunControls: React.FC = () => {
  const { plant, run, runLoaded, injectDecline, restartRun, recordBackwash } = usePlant();
  if (!plant) return null;

  if (!plant.simulation) {
    return <span className="hint">Readings are streaming from the plant controller.</span>;
  }
  if (!runLoaded || !run) {
    return <span className="hint">Starting the plant feed.</span>;
  }

  const running = run.status === 'running';
  const injectBlockedReason = !running
    ? 'Available once the baseline has been learned'
    : run.scenario
      ? 'A scenario is already active'
      : undefined;

  return (
    <div className="run-controls">
      <button type="button" className="btn btn-primary" disabled={!running || Boolean(run.scenario)} title={injectBlockedReason} onClick={() => void injectDecline()}>
        Inject production decline
      </button>
      <button type="button" className="btn" onClick={() => void restartRun()}>
        Restart
      </button>
      {injectBlockedReason && <span className="hint">{injectBlockedReason}.</span>}
      <details className="menu">
        <summary className="btn">Maintenance</summary>
        <div className="menu-body">
          <button type="button" className="btn" disabled={!running || !run.scenario} onClick={() => void recordBackwash()}>
            Record backwash complete
          </button>
          <p className="muted small">
            Sends the backwash event to the simulator directly. The field flow sends it only after the lever clip passes the staged rule.
          </p>
        </div>
      </details>
    </div>
  );
};

export const RunPanel: React.FC = () => {
  const { plant, run, feed, connection } = usePlant();
  if (!plant) return null;

  const status = run ? STATUS_TEXT[run.status] ?? humanize(run.status) : null;
  const tone: Tone = !run ? 'neutral' : run.status === 'running' ? 'ok' : 'accent';
  const feedText = connection === 'offline' ? 'Disconnected' : feed === 'stream' ? 'Live stream' : feed === 'polling' ? 'Polling every 2 s' : 'Idle';

  return (
    <section className="panel" aria-label="Run">
      <div className="panel-head">
        <h2 className="panel-title">{plant.simulation ? 'Simulation run' : 'Plant feed'}</h2>
        {plant.simulation && status && <Pill tone={tone}>{status}</Pill>}
      </div>
      <dl className="kv">
        <dt>Telemetry</dt>
        <dd>{feedText}</dd>
        {plant.simulation && (
          <>
            <dt>Started</dt>
            <dd>{formatTime(run?.started_at)}</dd>
            <dt>Baseline ready</dt>
            <dd>{formatTime(run?.baseline_ready_at)}</dd>
            <dt>Scenario</dt>
            <dd>{run?.scenario ? `${humanize(run.scenario)} since ${formatTime(run.scenario_started_at)}` : 'None'}</dd>
            <dt>Clock</dt>
            <dd>{run && run.clock_speed > 1 ? `${run.clock_speed}x sped up` : 'Real time'}</dd>
          </>
        )}
      </dl>
    </section>
  );
};

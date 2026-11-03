import React from 'react';
import { derivePhase, deriveStages, PHASE_TEXT, type RunPhase } from '../../lib/stages';
import { useNow } from '../../lib/useNow';
import { usePlant } from '../../state/PlantContext';
import { Icon } from '../common/Icon';
import { Pill, type Tone } from '../common/Pill';
import { StageRibbon } from './StageRibbon';

const BASELINE_SIM_S = 120;

const PHASE_TONE: Record<RunPhase, Tone> = {
  none: 'neutral',
  learning: 'accent',
  normal: 'ok',
  blockage: 'warning',
  recovering: 'accent',
  closed: 'ok',
};

function useBaselineProgress() {
  const { run } = usePlant();
  const now = useNow(500);
  if (!run || run.status === 'running' || run.status === 'stopped') return null;
  const totalS = BASELINE_SIM_S / Math.max(run.clock_speed, 1);
  const elapsedS = (now - Date.parse(run.started_at)) / 1000;
  const remaining = Math.max(0, Math.ceil(totalS - elapsedS));
  const waiting = run.status === 'starting' && elapsedS > 15;
  return { fraction: Math.min(1, Math.max(0, elapsedS / totalS)), remaining, waiting };
}

export const ActionBar: React.FC = () => {
  const { plant, run, runLoaded, flags, incident, incidents, selectedIncidentId, injectBlockage, resetRun, recordBackwash, busy } = usePlant();
  const progress = useBaselineProgress();
  if (!plant) return null;

  const summary = incidents.find((i) => i.incident_id === selectedIncidentId) ?? null;
  const detail = incident && incident.incident.incident_id === selectedIncidentId ? incident : null;
  const live = flags.filter((f) => f.status !== 'dismissed');
  const input = { run, flags: live, incident: detail, summary };
  const phase = derivePhase(input);
  const stages = deriveStages(input);

  let injectHint: string | null = null;
  let injectDisabled = false;
  if (!plant.simulation) {
    injectDisabled = true;
  } else if (!runLoaded || !run) {
    injectDisabled = true;
    injectHint = 'Starting the plant feed';
  } else if (progress) {
    injectDisabled = true;
    injectHint = progress.waiting
      ? 'Waiting for the simulator to pick up the run'
      : progress.remaining > 0
        ? `Learning baseline, about ${progress.remaining} s`
        : 'Finishing the baseline';
  } else if (run.scenario) {
    injectDisabled = true;
    injectHint = phase === 'closed' ? 'Scenario complete. Press Reset to run it again.' : 'Blockage is active. Reset to run it again.';
  } else if (busy.inject) {
    injectDisabled = true;
  }

  return (
    <div className="action-bar">
      <div className="action-row">
        {plant.simulation ? (
          <>
            <div className="action-inject">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={injectDisabled}
                aria-describedby="inject-note"
                onClick={() => void injectBlockage()}
              >
                <Icon name="alert" size={18} />
                {busy.inject ? 'Starting blockage' : 'Simulate flow blockage'}
              </button>
              <div className="inject-note" id="inject-note">
                {injectHint ? (
                  <>
                    <span className="inject-hint" role="status">
                      {injectHint}
                    </span>
                    {progress && !progress.waiting && (
                      <span className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)}>
                        <span style={{ width: `${progress.fraction * 100}%` }} />
                      </span>
                    )}
                  </>
                ) : (
                  <span className="muted">Hidden filter fouling. The PLC raises no alarm.</span>
                )}
              </div>
            </div>
            <button type="button" className="btn btn-lg" disabled={busy.reset || !runLoaded} onClick={() => void resetRun()}>
              <Icon name="refresh" size={18} />
              {busy.reset ? 'Resetting' : 'Reset'}
            </button>
            <Pill tone={PHASE_TONE[phase]}>{PHASE_TEXT[phase]}</Pill>
            <details className="menu menu-right">
              <summary className="btn btn-quiet btn-small">Maintenance</summary>
              <div className="menu-body">
                <button type="button" className="btn btn-small" disabled={!run || run.status !== 'running' || !run.scenario} onClick={() => void recordBackwash()}>
                  Record backwash complete
                </button>
                <p className="muted small">Sends the backwash event to the simulator directly. The field flow sends it only after the lever clip passes the staged rule.</p>
              </div>
            </details>
          </>
        ) : (
          <p className="hint">Readings are streaming from the plant controller.</p>
        )}
      </div>
      <StageRibbon stages={stages} />
    </div>
  );
};

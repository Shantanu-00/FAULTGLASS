import React from 'react';
import { usePlant } from '../../context/PlantContext';

export const NowBanner: React.FC = () => {
  const { activeIncident, stepIndex, activeScenario } = usePlant();

  // If nominal (no active incident)
  if (!activeIncident) {
    return (
      <div className="now-banner">
        <div className="now-tag-box">NOW</div>
        <div className="now-center">
          <div className="now-eyebrow">CONTINUOUS MONITORING · MUSE SPARK OPEN</div>
          <h1 className="now-headline">System Nominal — Watching Central Telemetry Baseline</h1>
          <p className="now-desc">
            Telemetry watcher evaluates sensor drift against learned baseline every 10s. When drift is flagged, Muse Wonder opens an incident and directs bounded field investigations.
          </p>
        </div>
        <div className="now-meta">
          <div className="now-meta-row">
            <span className="now-meta-label">EVIDENCE:</span>
            <span className="now-meta-val">Continuous baseline drift monitor</span>
          </div>
          <div className="now-meta-row">
            <span className="now-meta-label">AGENT GOAL:</span>
            <span className="now-meta-val">Maintain flow &amp; prevent false trips</span>
          </div>
          <div className="now-meta-row">
            <span className="now-meta-label">PROGRESS:</span>
            <span className="now-meta-val">STEP 01 — TELEMETRY WATCH</span>
          </div>
        </div>
      </div>
    );
  }

  const inv = activeIncident.investigation;
  const focus = inv.focus || {};
  const isPendingField = activeIncident.field_tasks.some((t) => t.status === 'pending');
  const activeTask = activeIncident.field_tasks.find((t) => t.status === 'pending');

  let eyebrow = `CURRENT AGENT ACTIVITY · ${inv.status.toUpperCase()}`;
  let headline = focus.next_step || focus.goal || activeIncident.incident.title;
  let desc = focus.blocker ? `Awaiting field evidence: ${focus.blocker}. Bounded task dispatched.` : (focus.goal || 'Investigating physical unmetered plant assets.');
  let progressStr = `STEP ${Math.max(1, stepIndex + 1)}/8 — ${inv.status.replace('_', ' ').toUpperCase()}`;

  if (isPendingField && activeTask) {
    eyebrow = `FIELD ACTION DISPATCHED · ${activeTask.kind.toUpperCase()}`;
    headline = activeTask.instruction;
    desc = `Dispatched to on-shift technician. Central system paused — awaiting physical dial evidence.`;
    progressStr = `STEP 3 — FIELD ACTION DISPATCHED`;
  } else if (inv.status === 'resolved') {
    eyebrow = `INCIDENT VERIFIED & CLOSED · SUSTAINED RECOVERY`;
    headline = `Flow Restored to 8.4 m³/h — Verified by Deterministic Telemetry Code`;
    desc = `System confirmed 30s sustained window of output flow and pressure differential.`;
    progressStr = `STEP 8 — RESOLVED`;
  }

  return (
    <div className="now-banner">
      <div className="now-tag-box">NOW</div>
      <div className="now-center">
        <div className="now-eyebrow">{eyebrow}</div>
        <h1 className="now-headline">{headline}</h1>
        <p className="now-desc">{desc}</p>
      </div>
      <div className="now-meta">
        <div className="now-meta-row">
          <span className="now-meta-label">EVIDENCE:</span>
          <span className="now-meta-val">
            {(focus.focus_assets || []).join(', ') || activeScenario?.id.toUpperCase() || 'Spark drift detection'}
          </span>
        </div>
        <div className="now-meta-row">
          <span className="now-meta-label">AGENT GOAL:</span>
          <span className="now-meta-val">{focus.goal || 'Directional flow restoration & ΔP relief'}</span>
        </div>
        <div className="now-meta-row">
          <span className="now-meta-label">PROGRESS:</span>
          <span className="now-meta-val">{progressStr}</span>
        </div>
      </div>
    </div>
  );
};

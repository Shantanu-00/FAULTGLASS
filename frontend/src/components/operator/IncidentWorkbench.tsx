import React from 'react';
import { formatDateTime, humanize } from '../../lib/format';
import { usePlant } from '../../state/PlantContext';
import type { IncidentDetail } from '../../types';
import { Pill, type Tone } from '../common/Pill';
import { FocusLedger } from './FocusLedger';
import { Hypotheses } from './Hypotheses';
import { AuditTrail, MemoryRecalled } from './MemoryAndTrace';
import { ActionProposals, FieldTasksSummary, VoiceObservations } from './ProposalsAndTasks';

const INVESTIGATION_TEXT: Record<string, string> = {
  not_started: 'Investigation not started',
  investigating: 'Investigating',
  waiting_field: 'Waiting for field evidence',
  awaiting_approval: 'Waiting for commander approval',
  concluded: 'Concluded, awaiting verification',
  escalated: 'Escalated to a human',
};

const STATUS_TONE: Record<string, Tone> = { open: 'warning', resolved: 'ok', closed: 'neutral' };

const FlagEvidence: React.FC<{ detail: IncidentDetail }> = ({ detail }) => {
  const flag = detail.flag;
  const signals = flag?.evidence?.signals;
  if (!flag || !signals || Object.keys(signals).length === 0) return null;
  return (
    <div className="flag-evidence">
      <p className="muted small">Evidence behind the flag, computed in code from the learned baseline:</p>
      <ul className="evidence-grid">
        {Object.entries(signals).map(([tag, s]) => (
          <li key={tag}>
            <code className="tag">{tag}</code>
            <span className="num strong">{s.current}</span>
            <span className="muted small">
              vs baseline {s.baseline} {s.unit}, {s.pct > 0 ? '+' : ''}
              {s.pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const IncidentWorkbench: React.FC<{ onOpenField: () => void }> = ({ onOpenField }) => {
  const { incident, incidents, selectedIncidentId, selectIncident, run } = usePlant();

  if (incidents.length === 0 || !selectedIncidentId) {
    return (
      <section className="panel quiet-state" aria-label="Incident">
        <h2 className="panel-title">Incident</h2>
        <p className="muted">
          No incident{run ? ' in this run' : ''}. When the watcher flags a signal that drifts from its baseline, an incident opens here and the investigator starts working.
        </p>
        {incidents.length > 0 && (
          <label className="select-row">
            <span>Earlier incidents</span>
            <select value="" onChange={(e) => selectIncident(e.target.value)}>
              <option value="" disabled>
                Select
              </option>
              {incidents.map((i) => (
                <option key={i.incident_id} value={i.incident_id}>
                  {i.incident_id} - {i.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
    );
  }

  if (!incident || incident.incident.incident_id !== selectedIncidentId) {
    return (
      <section className="panel quiet-state" aria-label="Incident">
        <h2 className="panel-title">Incident {selectedIncidentId}</h2>
        <p className="muted">Loading incident.</p>
      </section>
    );
  }

  const inv = incident.investigation;
  const investigatorModel = inv.model ?? null;
  const watcherModel = incident.flag?.model ?? null;
  const base = incident.incident;

  return (
    <section className="incident" aria-label="Incident">
      <div className="panel incident-head">
        <div className="incident-title">
          <div className="incident-line">
            <code className="tag">{base.incident_id}</code>
            <Pill tone={STATUS_TONE[base.status] ?? 'neutral'}>{humanize(base.status)}</Pill>
            <span className="incident-sub">{INVESTIGATION_TEXT[inv.status] ?? humanize(inv.status)}</span>
            <span className="muted small">
              {inv.steps_used} investigator step{inv.steps_used === 1 ? '' : 's'} - opened {formatDateTime(base.opened_at)}
            </span>
          </div>
          <h2>{base.title}</h2>
          {watcherModel && <p className="muted small">Flag raised by {watcherModel}. {incident.flag?.summary}</p>}
          <FlagEvidence detail={incident} />
        </div>
        {incidents.length > 1 && (
          <label className="select-row">
            <span>Incident</span>
            <select value={selectedIncidentId} onChange={(e) => selectIncident(e.target.value)}>
              {incidents.map((i) => (
                <option key={i.incident_id} value={i.incident_id}>
                  {i.incident_id} - {humanize(i.status)}
                </option>
              ))}
            </select>
          </label>
        )}
        {base.status !== 'open' && (base.root_cause || base.resolution) && (
          <div className="resolution">
            <strong>Closed by {base.closed_by ?? 'the verifier'}</strong>
            {base.root_cause && <p>{base.root_cause}</p>}
            {base.resolution && <p>{base.resolution}</p>}
          </div>
        )}
      </div>

      <div className="incident-grid">
        <div className="col">
          <FocusLedger focus={inv.focus} model={investigatorModel} />
          <Hypotheses items={incident.hypotheses} model={investigatorModel} />
        </div>
        <div className="col">
          <ActionProposals incidentId={base.incident_id} items={incident.action_proposals} model={investigatorModel} />
          <FieldTasksSummary tasks={incident.field_tasks} onOpenField={onOpenField} />
          <VoiceObservations items={incident.voice_observations} />
        </div>
        <div className="col">
          <MemoryRecalled trace={incident.trace} model={investigatorModel} />
          <AuditTrail trace={incident.trace} investigatorModel={investigatorModel} watcherModel={watcherModel} />
        </div>
      </div>
    </section>
  );
};

import React, { useRef } from 'react';
import { ConnectionBanner } from '../components/common/ConnectionBanner';
import { EvidenceMedia } from '../components/common/EvidenceMedia';
import { Icon } from '../components/common/Icon';
import { Pill } from '../components/common/Pill';
import { ObservationForm, GaugePhotoForm, ValveForm } from '../components/field/TaskForms';
import { TaskResultView } from '../components/field/Results';
import { PlantTwin, type PlantTwinHandle } from '../components/twin/PlantTwin';
import { TwinLegend } from '../components/twin/TwinLegend';
import { formatTime, humanize } from '../lib/format';
import { usePlant } from '../state/PlantContext';
import { useTwinState } from '../state/useTwinState';
import type { FieldTask } from '../types';
import '../styles/field.css';

const TITLE: Record<FieldTask['kind'], string> = {
  gauge_photo: 'Photograph the gauges',
  valve_action: 'Verify the staged valve action',
  observation: 'Inspect and report',
};

const TaskCard: React.FC<{ incidentId: string; task: FieldTask; index: number }> = ({ incidentId, task, index }) => (
  <article className={`task-card task-card-${task.kind}`} aria-label={TITLE[task.kind]}>
    <header><div><p className="field-section-label">Field task {String(index + 1).padStart(2, '0')}</p><h2>{TITLE[task.kind]}</h2></div><Pill tone="warning">Action needed</Pill></header>
    <p className="instruction">{task.instruction}</p>
    {(task.asset_ids.length > 0 || task.tags.length > 0) && <div className="chips">{[...new Set([...task.asset_ids, ...task.tags])].map((code) => <code className="tag tag-large" key={code}>{code}</code>)}</div>}
    {task.kind === 'gauge_photo' && <GaugePhotoForm incidentId={incidentId} task={task} />}
    {task.kind === 'valve_action' && <ValveForm incidentId={incidentId} task={task} />}
    {task.kind === 'observation' && <ObservationForm incidentId={incidentId} task={task} />}
    {Boolean(task.media?.length) && <div className="field-saved-media"><h3>Evidence already attached</h3><EvidenceMedia media={task.media} compact /></div>}
  </article>
);

const TwinCard: React.FC = () => {
  const { targets } = useTwinState();
  const twin = useRef<PlantTwinHandle | null>(null);
  if (targets.frame.length === 0) return null;
  return (
    <aside className="field-location">
      <section className="panel twin-card" aria-label="Task location">
        <div className="twin-card-head"><div><p className="field-section-label">Plant context</p><h2 className="panel-title">Where to go</h2></div><button type="button" className="btn btn-small" onClick={() => twin.current?.flyToTargets()}>Locate target</button></div>
        <div className={`twin-card-frame ${targets.assets.length > 3 ? 'labels-many' : 'labels-few'}`}><PlantTwin ref={twin} targets={targets} compactFraming /></div>
        <TwinLegend targets={targets} hasFlag={false} />
        <p className="capture-hint">Highlighted equipment belongs to the current field task. Drag to look around.</p>
      </section>
    </aside>
  );
};

export const FieldView: React.FC = () => {
  const { plant, incident, selectedIncidentId, connection, retry } = usePlant();
  const connecting = connection === 'connecting';
  if (!plant) return (
    <div className="field"><section className="field-start-state" aria-live="polite"><div className="field-state-icon"><Icon name={connecting ? 'refresh' : 'alert'} size={24} /></div><p className="field-section-label">Field workspace</p><h1>{connecting ? 'Connecting to your plant…' : 'Plant connection unavailable'}</h1><p className="muted">{connecting ? 'Your current job and work instructions will appear here.' : 'Check the connection and try again. Work instructions will appear when the plant is reachable.'}</p>{!connecting && <button type="button" className="btn btn-primary" onClick={retry}><Icon name="refresh" size={18} />Retry connection</button>}</section></div>
  );

  const detail = incident?.incident.incident_id === selectedIncidentId ? incident : null;
  const pending = detail?.field_tasks.filter((task) => task.status === 'pending') ?? [];
  const completed = detail?.field_tasks.filter((task) => task.status === 'completed') ?? [];
  const cancelled = detail?.field_tasks.filter((task) => task.status === 'cancelled') ?? [];
  const base = detail?.incident;
  const loadingIncident = Boolean(selectedIncidentId && !detail);
  const resolved = !!base && base.status !== 'open';

  return (
    <div className="field">
      <ConnectionBanner />
      <header className="field-head"><div><p className="field-section-label">Field operations</p><h1>Field workspace</h1><p className="field-subtitle">Capture evidence. Complete the requested action. Keep the investigation moving.</p></div><div className="field-job-count"><strong>{pending.length}</strong><span>{pending.length === 1 ? 'task waiting' : 'tasks waiting'}</span></div></header>
      {base && <section className="field-current-job" aria-label="Current job"><div><p className="field-section-label">Current job</p><h2>{base.title}</h2><div className="field-job-meta"><code>{base.incident_id}</code><span>{humanize(detail!.investigation.status)}</span></div></div><Pill tone={resolved ? 'ok' : pending.length ? 'warning' : 'accent'}>{resolved ? 'Resolved' : pending.length ? 'Your input needed' : 'Investigation running'}</Pill></section>}

      <div className="field-workspace">
        <section className="field-active-tasks" aria-label="Current field tasks">
          {loadingIncident ? <section className="panel field-waiting" role="status"><span className="field-spinner" aria-hidden="true" /><h2>Loading the current job…</h2><p className="muted">Checking for work instructions and previously submitted evidence.</p></section> : pending.length > 0 ? pending.map((task, index) => <TaskCard key={task.id} incidentId={base!.incident_id} task={task} index={index} />) : <section className="panel field-waiting"><span className="field-state-icon"><Icon name={completed.length ? 'check' : 'field'} size={24} /></span><p className="field-section-label">{resolved ? 'Work complete' : 'Standing by'}</p><h2>{resolved ? 'This incident is resolved' : completed.length ? 'Your evidence is with the investigator' : 'No field action needed'}</h2><p className="muted">{base ? resolved ? 'Submitted evidence and verification results remain available below.' : 'The investigator will request another check here if more evidence is needed.' : 'New jobs appear here automatically when the investigator needs a check on the plant.'}</p></section>}
        </section>
        {!loadingIncident && pending.length > 0 && <TwinCard />}
      </div>

      {completed.length > 0 && <section className="completed" aria-label="Submitted evidence"><header className="field-completed-head"><div><p className="field-section-label">Evidence archive</p><h2>Submitted from the field</h2></div><Pill tone="ok">{completed.length} completed</Pill></header><div className="field-completed-grid">{[...completed].reverse().map((task) => <article className="card field-evidence-card" key={task.id}><div className="card-head"><strong>{TITLE[task.kind]}</strong><Pill tone="ok">Submitted</Pill></div>{task.completed_at && <p className="field-evidence-time">Submitted at {formatTime(task.completed_at)}</p>}{task.result ? <TaskResultView result={task.result} /> : <p className="muted">The task is complete. Analysis details have not been returned yet.</p>}<EvidenceMedia media={task.media} emptyMessage="Original media is unavailable for this earlier submission. Recorded results are shown above." /></article>)}</div></section>}
      {cancelled.length > 0 && <details className="field-cancelled"><summary>{cancelled.length} cancelled {cancelled.length === 1 ? 'task' : 'tasks'}</summary>{cancelled.map((task) => <article key={task.id}><strong>{TITLE[task.kind]}</strong><p className="muted">{task.instruction}</p><Pill tone="neutral">No action required</Pill></article>)}</details>}
    </div>
  );
};

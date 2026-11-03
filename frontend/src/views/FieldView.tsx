import React from 'react';
import { ApiUnreachable } from '../components/common/ApiUnreachable';
import { ConnectionBanner } from '../components/common/ConnectionBanner';
import { Pill } from '../components/common/Pill';
import { ObservationForm, GaugePhotoForm, ValveForm } from '../components/field/TaskForms';
import { TaskResultView } from '../components/field/Results';
import { humanize } from '../lib/format';
import { usePlant } from '../state/PlantContext';
import type { FieldTask } from '../types';
import '../styles/field.css';

const TITLE: Record<FieldTask['kind'], string> = {
  gauge_photo: 'Photograph the gauges',
  valve_action: 'Move the lever in stages',
  observation: 'Report what you see',
};

const TaskCard: React.FC<{ incidentId: string; task: FieldTask }> = ({ incidentId, task }) => (
  <article className="task-card" aria-label={TITLE[task.kind]}>
    <header>
      <h2>{TITLE[task.kind]}</h2>
      <Pill tone="accent">To do</Pill>
    </header>
    <p className="instruction">{task.instruction}</p>
    {(task.asset_ids.length > 0 || task.tags.length > 0) && (
      <div className="chips">
        {[...task.asset_ids, ...task.tags].map((code) => (
          <code className="tag tag-large" key={code}>
            {code}
          </code>
        ))}
      </div>
    )}
    {task.kind === 'gauge_photo' && <GaugePhotoForm incidentId={incidentId} task={task} />}
    {task.kind === 'valve_action' && <ValveForm incidentId={incidentId} task={task} />}
    {task.kind === 'observation' && <ObservationForm incidentId={incidentId} task={task} />}
  </article>
);

export const FieldView: React.FC = () => {
  const { plant, incident, selectedIncidentId, incidents } = usePlant();
  if (!plant) return <ApiUnreachable />;

  const pending = incident?.field_tasks.filter((t) => t.status === 'pending') ?? [];
  const completed = incident?.field_tasks.filter((t) => t.status === 'completed') ?? [];
  const base = incident?.incident;

  return (
    <div className="field">
      <ConnectionBanner />
      <div className="field-head">
        <h1>Field companion</h1>
        {base ? (
          <p className="muted">
            <code className="tag">{base.incident_id}</code> {base.title}
            <span className="field-status"> - {humanize(incident!.investigation.status)}</span>
          </p>
        ) : (
          <p className="muted">
            {incidents.length > 0 && !selectedIncidentId ? 'No incident in this run.' : 'No incident is open.'} Field tasks appear here when the investigator needs a person to check something.
          </p>
        )}
      </div>

      {pending.length > 0 ? (
        pending.map((task) => <TaskCard key={task.id} incidentId={base!.incident_id} task={task} />)
      ) : (
        <section className="panel quiet-state">
          <h2 className="panel-title">No task waiting</h2>
          <p className="muted">
            {base ? 'All requested field evidence has been submitted. The investigator is working with it.' : 'This page checks for new tasks every few seconds.'}
          </p>
        </section>
      )}

      {completed.length > 0 && (
        <section className="completed" aria-label="Submitted evidence">
          <h2 className="panel-title">Submitted evidence</h2>
          {completed.map((task) => (
            <article className="card" key={task.id}>
              <div className="card-head">
                <strong>{TITLE[task.kind]}</strong>
                <Pill tone="ok">Done</Pill>
              </div>
              {task.result ? <TaskResultView result={task.result} /> : <p className="muted">No result recorded.</p>}
            </article>
          ))}
        </section>
      )}
    </div>
  );
};

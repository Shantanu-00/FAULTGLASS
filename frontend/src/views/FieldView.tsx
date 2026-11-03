import React, { useRef } from 'react';
import { ApiUnreachable } from '../components/common/ApiUnreachable';
import { Bi } from '../components/common/Bi';
import { ConnectionBanner } from '../components/common/ConnectionBanner';
import { Pill } from '../components/common/Pill';
import { ObservationForm, GaugePhotoForm, ValveForm } from '../components/field/TaskForms';
import { TaskResultView } from '../components/field/Results';
import { PlantTwin, type PlantTwinHandle } from '../components/twin/PlantTwin';
import { TwinLegend } from '../components/twin/TwinLegend';
import { humanize } from '../lib/format';
import { usePlant } from '../state/PlantContext';
import { useTwinState } from '../state/useTwinState';
import type { FieldTask } from '../types';
import '../styles/field.css';

const TITLE: Record<FieldTask['kind'], { en: string; mr: string }> = {
  gauge_photo: { en: 'Photograph the gauges', mr: 'गेजचा फोटो घ्या' },
  valve_action: { en: 'Move the lever in stages', mr: 'झडप टप्प्याटप्पाने फिरवा' },
  observation: { en: 'Field observation', mr: 'निरीक्षण' },
};

const TaskCard: React.FC<{ incidentId: string; task: FieldTask }> = ({ incidentId, task }) => (
  <article className="task-card" aria-label={TITLE[task.kind].en}>
    <header>
      <h2>
        <Bi stack en={TITLE[task.kind].en} mr={TITLE[task.kind].mr} />
      </h2>
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

const TwinCard: React.FC = () => {
  const { targets } = useTwinState();
  const twin = useRef<PlantTwinHandle | null>(null);
  if (targets.frame.length === 0) return null;
  return (
    <section className="panel twin-card" aria-label="Where to go">
      <div className="twin-card-head">
        <h2 className="panel-title">Where to go</h2>
        <button type="button" className="btn btn-small btn-accent" onClick={() => twin.current?.flyToTargets()}>
          Show on twin
        </button>
      </div>
      <div className={`twin-card-frame ${targets.assets.length > 3 ? "labels-many" : "labels-few"}`}>
        <PlantTwin ref={twin} targets={targets} />
      </div>
      <TwinLegend targets={targets} hasFlag={false} />
    </section>
  );
};

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
        <h1>
          <Bi en="Field companion" mr="फील्ड सोबती" />
        </h1>
        <p className="eyebrow">
          <Bi en="Current job" mr="सध्याचे काम" />
        </p>
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

      <TwinCard />

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
          <h2 className="panel-title">
            <Bi en="Submitted evidence" mr="जमा पुरावा" />
          </h2>
          {completed.map((task) => (
            <article className="card" key={task.id}>
              <div className="card-head">
                <strong>{TITLE[task.kind].en}</strong>
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

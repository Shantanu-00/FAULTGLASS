import React from 'react';
import { derivePhase } from '../../lib/stages';
import { usePlant } from '../../state/PlantContext';
import { ClosedResult } from './ClosedResult';
import { FlagCard } from './FlagCard';
import { FocusLedger } from './FocusLedger';
import { Hypotheses } from './Hypotheses';
import { AuditTrail, MemoryRecalled } from './MemoryAndTrace';
import { FieldTaskCard, ProposalCard, VoiceCard } from './ProposalsAndTasks';

const Empty: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="panel stack-card quiet-state" aria-label={title}>
    <h3 className="panel-title">{title}</h3>
    <p className="muted">{children}</p>
  </section>
);

export const InvestigationStack: React.FC = () => {
  const { plant, run, flags, incident, incidents, selectedIncidentId } = usePlant();
  if (!plant) return null;

  const live = flags.filter((f) => f.status !== 'dismissed');
  const detail = incident && incident.incident.incident_id === selectedIncidentId ? incident : null;

  if (!selectedIncidentId) {
    const phase = derivePhase({ run, flags: live, incident: null, summary: null });
    return (
      <div className="stack">
        {live.length > 0 ? (
          <FlagCard flag={live[0]} />
        ) : (
          <Empty title="Spark watcher">
            {phase === 'learning'
              ? 'Learning the baseline. The watcher starts reading once every streamed measurement has a baseline.'
              : phase === 'blockage'
                ? 'The blockage is active. No flag yet: the watcher reads the telemetry summary periodically and has not raised one.'
                : 'No flag yet. Telemetry is within its normal band.'}
          </Empty>
        )}
        <Empty title="Wonder investigation">No incident. When the watcher flags drift, an incident opens here and Muse Wonder starts working it.</Empty>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="stack">
        {live.length > 0 && <FlagCard flag={live[0]} />}
        <Empty title={`Incident ${selectedIncidentId}`}>Loading incident.</Empty>
      </div>
    );
  }

  const base = detail.incident;
  const inv = detail.investigation;
  const model = inv.model ?? null;
  const watcherModel = detail.flag?.model ?? null;
  const pending = detail.action_proposals.filter((p) => p.status === 'pending');
  const settled = detail.action_proposals.filter((p) => p.status !== 'pending');
  const tasks = [...detail.field_tasks].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));

  return (
    <div className="stack">
      {base.status !== 'open' && <ClosedResult detail={detail} />}
      {pending.map((p) => (
        <ProposalCard key={p.id} incidentId={base.incident_id} proposal={p} model={model} />
      ))}
      {detail.flag ? <FlagCard flag={detail.flag} /> : live.length > 0 && <FlagCard flag={live[0]} />}
      <FocusLedger focus={inv.focus} model={model} status={inv.status} steps={inv.steps_used} />
      <Hypotheses items={detail.hypotheses} model={model} />
      {tasks.map((t) => (
        <FieldTaskCard key={t.id} task={t} />
      ))}
      <VoiceCard items={detail.voice_observations} />
      {settled.map((p) => (
        <ProposalCard key={p.id} incidentId={base.incident_id} proposal={p} model={model} />
      ))}
      <MemoryRecalled trace={detail.trace} model={model} />
      <AuditTrail trace={detail.trace} investigatorModel={model} watcherModel={watcherModel} />
    </div>
  );
};

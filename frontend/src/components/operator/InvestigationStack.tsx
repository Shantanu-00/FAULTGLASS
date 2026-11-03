import React from 'react';
import { hasWonderFindings, latestTrace } from '../../lib/commander';
import { usePlant } from '../../state/PlantContext';
import { ClosedResult } from './ClosedResult';
import { FlagCard } from './FlagCard';
import { FocusLedger } from './FocusLedger';
import { Hypotheses } from './Hypotheses';
import { MemoryRecalled } from './MemoryAndTrace';
import { FieldTaskCard, GaugeEvidence, ProposalCard, VoiceCard } from './ProposalsAndTasks';
import '../../styles/investigation.css';
import '../../styles/hypothesis.css';

const Waiting: React.FC<{ title: string; children: React.ReactNode; loading?: boolean }> = ({ title, children, loading }) => (
  <section className="investigation-card investigation-waiting" aria-busy={loading || undefined}>
    <h3>{title}</h3><p>{children}</p>
  </section>
);

export const InvestigationStack: React.FC<{ area?: 'active' | 'records' }> = ({ area = 'active' }) => {
  const { plant, run, flags, incident, selectedIncidentId, connection, refreshIncident } = usePlant();
  if (!plant) return null;
  const live = [...flags].filter((flag) => flag.status !== 'dismissed' && flag.status !== 'resolved')
    .sort((a, b) => Date.parse(b.raised_at) - Date.parse(a.raised_at));
  const detail = incident?.incident.incident_id === selectedIncidentId ? incident : null;
  if (area === 'records' && !detail) return null;

  if (!selectedIncidentId) return <div className="investigation-stack">
    {live[0] ? <FlagCard flag={live[0]} /> : <Waiting title={connection === 'offline' ? 'Live updates paused' : run?.status === 'stopped' ? 'Monitoring is paused' : run?.status === 'starting' || run?.status === 'learning' ? 'Learning the plant' : 'Watching for drift'} loading={connection !== 'offline' && (run?.status === 'starting' || run?.status === 'learning')}>
      {connection === 'offline' ? 'Reconnect to resume live monitoring. The last received plant state is preserved.' : run?.status === 'stopped' ? 'The plant feed has stopped. Start a new demo run to resume monitoring.' : run?.status === 'starting' || run?.status === 'learning'
        ? 'Spark is establishing the operating baseline. A detected change will open an investigation here.'
        : 'Spark monitors the live readings. When it finds abnormal drift, Wonder investigates the cause and requests the evidence it needs.'}
    </Waiting>}
    {live[0] && <p className="investigation-handoff" role="status">{connection === 'offline' ? 'Updates are paused. Reconnect to retrieve the investigation.' : 'Opening the incident for Wonder to investigate.'}</p>}
    <Hypotheses items={[]} model={null} />
  </div>;

  if (!detail) return <div className="investigation-stack">
    {live[0] && <FlagCard flag={live[0]} />}
    <Waiting title={connection === 'offline' ? 'Investigation unavailable' : 'Loading the investigation'} loading={connection !== 'offline'}>
      {connection === 'offline' ? 'The connection is interrupted. Reconnect to retrieve the incident details.' : 'Retrieving the latest findings and field requests.'}
    </Waiting>
    {connection === 'online' && <button className="btn btn-small" type="button" onClick={() => void refreshIncident()}>Refresh investigation</button>}
  </div>;

  const base = detail.incident;
  const inv = detail.investigation;
  const model = inv.model ?? null;
  const closed = base.status !== 'open';
  const progressed = hasWonderFindings(detail);
  const flag = detail.flag ?? live[0];
  const pendingProposals = detail.action_proposals.filter((proposal) => proposal.status === 'pending');
  const previousProposals = detail.action_proposals.filter((proposal) => proposal.status !== 'pending');
  const pendingTasks = detail.field_tasks.filter((task) => task.status === 'pending')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const completedTasks = detail.field_tasks.filter((task) => task.status !== 'pending')
    .sort((a, b) => Date.parse(b.completed_at ?? b.created_at) - Date.parse(a.completed_at ?? a.created_at));
  const evidenceTasks = detail.field_tasks.filter((task) => task.status !== 'pending' || !!task.media?.length || !!task.result)
    .sort((a, b) => Date.parse(b.completed_at ?? b.created_at) - Date.parse(a.completed_at ?? a.created_at));
  const gauge = completedTasks.find((task) => task.kind === 'gauge_photo' && task.status === 'completed' && task.result);
  const failed = detail.action_proposals.some((proposal) => proposal.status === 'failed');
  const verification = latestTrace(detail, (entry) => entry.kind === 'verification');
  const waitingVerification = !closed && detail.action_proposals.some((proposal) => proposal.status === 'executed');
  const hasNextAction = pendingProposals.length > 0 || pendingTasks.length > 0;

  if (area === 'records') return <div className="command-record-grid" aria-label="Incident evidence and records">
    <section className="command-record-group" aria-labelledby="field-evidence-title">
      <div className="command-record-heading"><span className="command-eyebrow">Photos · audio · recordings</span><h2 id="field-evidence-title">Field evidence</h2></div>
      {gauge?.result && <GaugeEvidence result={gauge.result} completedAt={gauge.completed_at} />}
      <VoiceCard items={detail.voice_observations} />
      {evidenceTasks.map((task) => <FieldTaskCard key={task.id} task={task} />)}
      {!evidenceTasks.length && !detail.voice_observations.length && <div className="investigation-card record-empty"><p>No field evidence has been submitted yet. Photos, voice notes and valve clips will appear here with their results.</p></div>}
    </section>
    <section className="command-record-group" aria-labelledby="incident-record-title">
      <div className="command-record-heading"><span className="command-eyebrow">Detection · sources · decisions</span><h2 id="incident-record-title">Incident record</h2></div>
      {flag && <details className="investigation-disclosure initial-detection">
        <summary><span>Initial detection <span className="investigation-summary-detail">Spark</span></span><span className="disclosure-plus" aria-hidden="true">+</span></summary>
        <div className="investigation-disclosure-body"><FlagCard flag={flag} /></div>
      </details>}
      <details className="investigation-disclosure investigation-history">
        <summary><span>Evidence archive <span className="investigation-summary-detail">Sources & action records</span></span><span className="disclosure-plus" aria-hidden="true">+</span></summary>
        <div className="investigation-disclosure-body investigation-stack">
          <p className="investigation-record-id">Incident {base.incident_id}</p>
          <FocusLedger focus={inv.focus} model={model} status={inv.status} steps={inv.steps_used} />
          {previousProposals.map((proposal) => <ProposalCard key={proposal.id} incidentId={base.incident_id} proposal={proposal} model={model} />)}
          <MemoryRecalled trace={detail.trace} model={model} />
        </div>
      </details>
    </section>
  </div>;

  return <div className="investigation-stack">
    {connection === 'offline' && <div className="investigation-notice" role="status">Updates are paused. These are the last received findings; approval is unavailable while disconnected.</div>}
    {closed ? <ClosedResult detail={detail} /> : <>
      {(failed || inv.status === 'escalated') && <section className="investigation-card investigation-attention" role="status">
        <span className="investigation-eyebrow">Human review needed</span>
        <h3>{failed ? 'Recovery did not pass verification' : 'Wonder needs your review'}</h3>
        <p>{failed ? verification?.content ?? 'Review the action and its evidence before proceeding.' : inv.focus.blocker || 'The investigation has been escalated. Review the recorded findings and activity.'}</p>
      </section>}
      {!progressed && flag && <FlagCard flag={flag} />}
      {!progressed && <div className="investigation-handoff" role="status">
        <span className="investigation-eyebrow">Wonder investigation</span>
        <p>{inv.status === 'not_started' ? 'Ready to investigate the detected drift.' : 'Reviewing the plant history and telemetry. Findings will appear when evidence is recorded.'}</p>
      </div>}
      {pendingProposals.map((proposal) => <ProposalCard key={proposal.id} incidentId={base.incident_id} proposal={proposal} model={model} />)}
      {pendingTasks.map((task) => <FieldTaskCard key={task.id} task={task} />)}
      {waitingVerification && <section className="investigation-card investigation-verifying" role="status">
        <span className="investigation-eyebrow">Verification in progress</span><h3>Watching the plant recover</h3>
        <p>The staged valve movement passed. The verifier is checking live telemetry before confirming the outcome.</p>
      </section>}
      <Hypotheses items={detail.hypotheses} model={model} detail={detail} />
    </>}
    {closed && <Hypotheses items={detail.hypotheses} model={model} detail={detail} />}
    {!closed && progressed && !hasNextAction && !waitingVerification && inv.status !== 'escalated' && !failed && <FocusLedger focus={inv.focus} model={model} status={inv.status} steps={inv.steps_used} />}
  </div>;
};

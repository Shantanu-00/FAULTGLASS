import React, { useState } from 'react';
import { api } from '../../api/client';
import { errorMessage, formatTime, humanize } from '../../lib/format';
import { usePlant } from '../../state/PlantContext';
import type { ActionProposal, Differential, FieldTask, FieldTaskResult, VoiceObservation } from '../../types';
import { Pill, type Tone } from '../common/Pill';
import { TaskResultView, VoiceResult } from '../field/Results';
import { EvidenceMedia } from '../common/EvidenceMedia';

const PROPOSAL_TEXT: Record<ActionProposal['status'], { text: string; tone: Tone }> = {
  pending: { text: 'Your decision', tone: 'accent' },
  approved: { text: 'Approved', tone: 'ok' },
  rejected: { text: 'Rejected', tone: 'neutral' },
  executed: { text: 'Staged action passed', tone: 'ok' },
  failed: { text: 'Verification failed', tone: 'warning' },
};

export const ProposalCard: React.FC<{ incidentId: string; proposal: ActionProposal; model: string | null }> = ({ incidentId, proposal, model }) => {
  const { refreshIncident, notify, connection } = usePlant();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const effectiveStatus = proposal.status === 'pending' && decision ? decision : proposal.status;
  const status = PROPOSAL_TEXT[effectiveStatus];
  const decide = async (approve: boolean) => {
    if (busy || decision || connection !== 'online') return;
    setBusy(approve ? 'approve' : 'reject');
    setError(null);
    setSyncWarning(null);
    try {
      if (approve) {
        await api.approveProposal(incidentId, proposal.id);
        notify(`Approved. The ${proposal.asset_id} task is ready in Field.`);
      } else {
        await api.rejectProposal(incidentId, proposal.id);
        notify('Proposal rejected. Wonder will continue investigating.');
      }
      setDecision(approve ? 'approved' : 'rejected');
      try { await refreshIncident(); } catch { setSyncWarning('Your decision was saved. Live updates are delayed; refresh the incident to see the latest task.'); }
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      notify(message, 'error');
    } finally { setBusy(null); }
  };

  return <section className={`investigation-card command-proposal command-proposal-${effectiveStatus}`} aria-label="Action proposal" aria-busy={busy !== null}>
    <div className="investigation-card-head"><span className="investigation-eyebrow">{effectiveStatus === 'pending' ? 'Next action · approval required' : 'Action record'}</span><Pill tone={status.tone}>{status.text}</Pill></div>
    <h3>{humanize(proposal.action)} <span className="proposal-asset">{proposal.asset_id}</span></h3>
    <p>{proposal.rationale}</p>
    {proposal.sop_id && <p className="investigation-meta">Procedure <code>{proposal.sop_id}</code></p>}
    {effectiveStatus === 'pending' && <>
      <p className="proposal-approval-note">Approval sends the staged valve task to the worker. The submitted clip must pass verification.</p>
      <div className="proposal-actions">
        <button type="button" className="btn proposal-approve" disabled={busy !== null || connection !== 'online'} onClick={() => void decide(true)}>{busy === 'approve' ? <><span className="control-spinner" aria-hidden="true" />Saving approval…</> : `Approve ${proposal.action}`}</button>
        <button type="button" className="btn proposal-reject" disabled={busy !== null || connection !== 'online'} onClick={() => void decide(false)}>{busy === 'reject' ? 'Rejecting…' : 'Reject'}</button>
      </div>
      {connection !== 'online' && <p className="investigation-meta">Reconnect to approve or reject this proposal.</p>}
    </>}
    {error && <p className="investigation-error" role="alert">{error}</p>}
    {syncWarning && <p className="proposal-sync-warning" role="status">{syncWarning}</p>}
    {effectiveStatus === 'approved' && <a className="btn proposal-approved-link" href="?view=field">Open worker task <span aria-hidden="true">↗</span></a>}
    {effectiveStatus !== 'pending' && <p className="investigation-meta" role="status">{effectiveStatus === 'approved' ? 'The worker task has been dispatched.' : effectiveStatus === 'executed' ? 'The staged movement passed; recovery is checked separately.' : effectiveStatus === 'rejected' ? 'The decision was returned to the investigator.' : 'Review the verification record in Activity.'}</p>}
    {proposal.status === 'pending' && decision && !busy && <button type="button" className="btn btn-small" onClick={() => void refreshIncident()}>Refresh current task</button>}
    <details className="investigation-inline-details"><summary>Proposal source</summary><p className="investigation-meta">{model || 'Wonder'} · {formatTime(proposal.created_at)}</p></details>
  </section>;
};

export function resultDifferential(result: FieldTaskResult): Differential | null {
  const value = (result as FieldTaskResult & { differential?: Differential | null }).differential;
  return value && typeof value.inlet_tag === 'string' && typeof value.outlet_tag === 'string'
    && [value.inlet_psi, value.outlet_psi, value.dp_psi, value.normal_dp_psi, value.limit_dp_psi].every(Number.isFinite)
    && typeof value.restricted === 'boolean' ? value : null;
}

export const GaugeEvidence: React.FC<{ result: FieldTaskResult; completedAt?: string | null }> = ({ result, completedAt }) => {
  const differential = resultDifferential(result);
  const values = differential
    ? [{ tag: differential.inlet_tag, label: 'Bank inlet', value: differential.inlet_psi }, { tag: differential.outlet_tag, label: 'Bank outlet', value: differential.outlet_psi }]
    : Object.entries(result.readings ?? {}).map(([tag, value]) => ({ tag, label: tag, value })).filter(({ value }) => Number.isFinite(value));
  return <section className="investigation-card gauge-evidence" aria-label="Gauge evidence">
    <div className="investigation-card-head"><span className="investigation-eyebrow">Field evidence · gauge readings</span><Pill tone="neutral">Received</Pill></div>
    {values.length > 0 ? <div className="gauge-pair">{values.map((reading) => <div key={reading.tag}><span>{reading.label}</span><strong>{reading.value.toFixed(1)} <small>psi</small></strong><code>{reading.tag}</code></div>)}</div> : <p>Field evidence received. Open the reading details to review the result.</p>}
    {differential && <div className={`gauge-differential${differential.restricted ? ' is-restricted' : ''}`}>
      <div><span>Pressure differential</span><strong>{differential.dp_psi.toFixed(1)} <small>psi</small></strong></div>
      <Pill tone={differential.restricted ? 'warning' : 'ok'}>{differential.restricted ? 'Restriction indicated' : 'Within normal range'}</Pill>
      <p>Inlet minus outlet. Restriction threshold {differential.limit_dp_psi.toFixed(1)} psi; normal {differential.normal_dp_psi.toFixed(1)} psi.</p>
    </div>}
    <details className="investigation-inline-details"><summary>Reading and validation details</summary><TaskResultView result={result} hideVoice /></details>
    {completedAt && <div className="investigation-card-foot"><span>{result.source === 'gauge_photo' ? 'From submitted gauge photos' : 'From the field submission'}</span><time dateTime={completedAt}>{formatTime(completedAt)}</time></div>}
  </section>;
};

const TASK_TITLE: Record<FieldTask['kind'], string> = { gauge_photo: 'Gauge photos', valve_action: 'Staged valve movement', observation: 'Field observation' };
function taskStatus(task: FieldTask): { text: string; tone: Tone } {
  if (task.status === 'cancelled') return { text: 'Cancelled', tone: 'neutral' };
  if (task.status === 'completed') return { text: task.kind === 'valve_action' ? 'Clip passed' : 'Evidence received', tone: 'ok' };
  return { text: task.kind === 'valve_action' ? 'Waiting for clip' : 'Waiting for worker', tone: 'accent' };
}
export const FieldTaskCard: React.FC<{ task: FieldTask }> = ({ task }) => {
  const status = taskStatus(task);
  return <section className={`investigation-card command-field-task task-${task.status}`} aria-label={TASK_TITLE[task.kind]}>
    <div className="investigation-card-head"><span className="investigation-eyebrow">{task.status === 'pending' ? 'Next action · field task' : 'Field task record'}</span><Pill tone={status.tone}>{status.text}</Pill></div>
    <h3>{TASK_TITLE[task.kind]}</h3><p>{task.instruction}</p>
    <div className="investigation-tags">{[...new Set([...task.asset_ids, ...task.tags])].map((code) => <code key={code}>{code}</code>)}</div>
    {task.status === 'pending' && <a className="field-workspace-link" href="?view=field">Open Field workspace <span aria-hidden="true">↗</span></a>}
    {(task.result || task.media?.length) && <details className="investigation-inline-details" open={task.status === 'completed'}><summary>Submitted evidence</summary><EvidenceMedia media={task.media} />{task.result ? <TaskResultView result={task.result} /> : <p className="investigation-meta">Media received. Analysis has not produced a result yet.</p>}</details>}
    <div className="investigation-card-foot"><span>{task.status === 'pending' ? 'Requested' : task.status === 'completed' ? 'Completed' : 'Requested'}</span><time dateTime={task.completed_at ?? task.created_at}>{formatTime(task.completed_at ?? task.created_at)}</time></div>
  </section>;
};

export const VoiceCard: React.FC<{ items: VoiceObservation[] }> = ({ items }) => items.length === 0 ? null : (
  <section className="investigation-card" aria-label="Worker observations">
    <div className="investigation-card-head"><h3>Worker observations</h3><span className="investigation-meta">{items.length} recorded</span></div>
    {items.map((voice) => <div className="voice-item" key={voice.id}><EvidenceMedia media={voice.media} compact /><VoiceResult voice={{ transcript: voice.transcript, comparison: voice.comparison ?? undefined, structured: voice.structured ?? undefined, model: voice.model }} /></div>)}
  </section>
);

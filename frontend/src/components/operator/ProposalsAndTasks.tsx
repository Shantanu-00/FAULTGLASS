import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { errorMessage, formatTime, humanize } from '../../lib/format';
import { usePlant } from '../../state/PlantContext';
import type { ActionProposal, FieldTask, VoiceObservation } from '../../types';
import { Pill, type Tone } from '../common/Pill';
import { TaskResultView, VoiceResult } from '../field/Results';

const PROPOSAL_TEXT: Record<ActionProposal['status'], { text: string; tone: Tone }> = {
  pending: { text: 'Awaiting your decision', tone: 'accent' },
  approved: { text: 'Approved, valve task sent to the field', tone: 'ok' },
  rejected: { text: 'Rejected', tone: 'neutral' },
  executed: { text: 'Executed after the staged check passed', tone: 'ok' },
  failed: { text: 'Verification failed', tone: 'alarm' },
};

export const ProposalCard: React.FC<{ incidentId: string; proposal: ActionProposal; model: string | null }> = ({ incidentId, proposal: p, model }) => {
  const { refreshIncident, notify } = usePlant();
  const [busy, setBusy] = useState(false);
  const status = PROPOSAL_TEXT[p.status];
  const card = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (p.status === 'pending') card.current?.scrollIntoView({ block: 'nearest' });
  }, [p.status]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      if (approve) {
        await api.approveProposal(incidentId, p.id);
        notify(`Approved. The ${p.asset_id} task is now on the Field view.`);
      } else {
        await api.rejectProposal(incidentId, p.id);
        notify('Proposal rejected. The investigator has been told.');
      }
      await refreshIncident();
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section ref={card} className={`panel stack-card proposal proposal-${p.status}`} aria-label="Action proposal">
      <div className="panel-head">
        <h3 className="panel-title">
          Proposed action: {humanize(p.action)} <code className="tag">{p.asset_id}</code>
        </h3>
        <Pill tone={status.tone}>{status.text}</Pill>
      </div>
      <p>{p.rationale}</p>
      {p.sop_id && (
        <p className="muted small">
          Procedure <code className="tag">{p.sop_id}</code>
        </p>
      )}
      {p.status === 'pending' && (
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void decide(true)}>
            Approve {p.action} on {p.asset_id}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void decide(false)}>
            Reject
          </button>
        </div>
      )}
      <p className="attribution">
        {model ? `Proposed by ${model}` : 'Proposed by the investigator'}. Nothing moves until you approve, and code verifies the result.
      </p>
    </section>
  );
};

const TASK_TITLE: Record<FieldTask['kind'], string> = {
  gauge_photo: 'Gauge photo',
  valve_action: 'Valve lever clip',
  observation: 'Field observation',
};

function taskStatus(task: FieldTask): { text: string; tone: Tone } {
  if (task.status === 'cancelled') return { text: 'Cancelled', tone: 'neutral' };
  if (task.status === 'completed') {
    if (task.kind === 'gauge_photo') return { text: 'Photo received', tone: 'ok' };
    if (task.kind === 'valve_action') return { text: 'Clip passed', tone: 'ok' };
    return { text: 'Submitted', tone: 'ok' };
  }
  return { text: task.kind === 'valve_action' ? 'Waiting for lever clip' : 'Waiting for worker', tone: 'accent' };
}

export const FieldTaskCard: React.FC<{ task: FieldTask }> = ({ task }) => {
  const status = taskStatus(task);
  return (
    <section className={`panel stack-card task-${task.status}`} aria-label={TASK_TITLE[task.kind]}>
      <div className="panel-head">
        <h3 className="panel-title">Field task: {TASK_TITLE[task.kind].toLowerCase()}</h3>
        <Pill tone={status.tone}>{status.text}</Pill>
      </div>
      <p>{task.instruction}</p>
      <div className="chips">
        {[...task.asset_ids, ...task.tags].map((code) => (
          <code className="tag" key={code}>
            {code}
          </code>
        ))}
      </div>
      {task.result ? (
        <TaskResultView result={task.result} hideVoice />
      ) : (
        task.status === 'pending' && <p className="muted small">Sent to the Field view at {formatTime(task.created_at)}. The investigation is paused until the worker submits.</p>
      )}
    </section>
  );
};

export const VoiceCard: React.FC<{ items: VoiceObservation[] }> = ({ items }) => {
  if (items.length === 0) return null;
  return (
    <section className="panel stack-card" aria-label="Voice note">
      <div className="panel-head">
        <h3 className="panel-title">Voice note</h3>
        <span className="count">{items.length}</span>
      </div>
      {items.map((v) => (
        <div className="voice-item" key={v.id}>
          <VoiceResult voice={{ transcript: v.transcript, comparison: v.comparison ?? undefined, structured: v.structured ?? undefined, model: v.model }} />
        </div>
      ))}
    </section>
  );
};

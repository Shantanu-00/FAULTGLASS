import React, { useState } from 'react';
import { api } from '../../api/client';
import { errorMessage, formatTime, humanize } from '../../lib/format';
import { usePlant } from '../../state/PlantContext';
import type { ActionProposal, FieldTask, VoiceObservation } from '../../types';
import { Pill, type Tone } from '../common/Pill';
import { TaskResultView, VoiceResult } from '../field/Results';

const PROPOSAL_TEXT: Record<ActionProposal['status'], { text: string; tone: Tone }> = {
  pending: { text: 'Awaiting your decision', tone: 'accent' },
  approved: { text: 'Approved, field task dispatched', tone: 'ok' },
  rejected: { text: 'Rejected', tone: 'neutral' },
  executed: { text: 'Executed after the staged check passed', tone: 'ok' },
  failed: { text: 'Failed', tone: 'alarm' },
};

export const ActionProposals: React.FC<{ incidentId: string; items: ActionProposal[]; model: string | null }> = ({ incidentId, items, model }) => {
  const { refreshIncident, notify } = usePlant();
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (proposal: ActionProposal, approve: boolean) => {
    setBusy(proposal.id);
    try {
      if (approve) {
        await api.approveProposal(incidentId, proposal.id);
        notify('Approved. The valve task is now on the Field view.');
      } else {
        await api.rejectProposal(incidentId, proposal.id);
        notify('Proposal rejected. The investigator has been told.');
      }
      await refreshIncident();
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel" aria-label="Action proposals">
      <div className="panel-head">
        <h3 className="panel-title">Action proposals</h3>
        {model && <span className="attribution">Proposed by {model}</span>}
      </div>
      <p className="muted small">The model proposes. Nothing moves until you approve, and code verifies the result.</p>
      {items.length === 0 ? (
        <p className="muted">No action proposed.</p>
      ) : (
        items.map((p) => {
          const status = PROPOSAL_TEXT[p.status];
          return (
            <article className={`card proposal proposal-${p.status}`} key={p.id}>
              <div className="card-head">
                <strong>
                  {humanize(p.action)} <code className="tag">{p.asset_id}</code>
                </strong>
                <Pill tone={status.tone}>{status.text}</Pill>
              </div>
              <p>{p.rationale}</p>
              {p.sop_id && <p className="muted small">Procedure: <code className="tag">{p.sop_id}</code></p>}
              {p.status === 'pending' && (
                <div className="btn-row">
                  <button type="button" className="btn btn-primary" disabled={busy === p.id} onClick={() => void decide(p, true)}>
                    Approve valve task
                  </button>
                  <button type="button" className="btn" disabled={busy === p.id} onClick={() => void decide(p, false)}>
                    Reject
                  </button>
                </div>
              )}
            </article>
          );
        })
      )}
    </section>
  );
};

const TASK_TITLE: Record<FieldTask['kind'], string> = {
  gauge_photo: 'Gauge photo',
  valve_action: 'Valve lever clip',
  observation: 'Field observation',
};

export const FieldTasksSummary: React.FC<{ tasks: FieldTask[]; onOpenField: () => void }> = ({ tasks, onOpenField }) => (
  <section className="panel" aria-label="Field tasks">
    <div className="panel-head">
      <h3 className="panel-title">Field tasks</h3>
      {tasks.some((t) => t.status === 'pending') && (
        <button type="button" className="btn btn-small" onClick={onOpenField}>
          Open Field view
        </button>
      )}
    </div>
    {tasks.length === 0 ? (
      <p className="muted">No physical check requested. The investigator asks for one only when telemetry cannot answer.</p>
    ) : (
      tasks.map((t) => (
        <article className="card" key={t.id}>
          <div className="card-head">
            <strong>{TASK_TITLE[t.kind]}</strong>
            <Pill tone={t.status === 'completed' ? 'ok' : t.status === 'pending' ? 'accent' : 'neutral'}>{humanize(t.status)}</Pill>
          </div>
          <p>{t.instruction}</p>
          <div className="chips">
            {[...t.asset_ids, ...t.tags].map((code) => (
              <code className="tag" key={code}>
                {code}
              </code>
            ))}
          </div>
          {t.result && <TaskResultView result={t.result} />}
        </article>
      ))
    )}
  </section>
);

export const VoiceObservations: React.FC<{ items: VoiceObservation[] }> = ({ items }) => {
  if (items.length === 0) return null;
  return (
    <section className="panel" aria-label="Voice observations">
      <div className="panel-head">
        <h3 className="panel-title">Voice observations</h3>
        <span className="count">{items.length}</span>
      </div>
      {items.map((v) => (
        <article className="card" key={v.id}>
          <p className="muted small">{formatTime(v.created_at)}</p>
          <VoiceResult voice={{ transcript: v.transcript, comparison: v.comparison ?? undefined, structured: v.structured ?? undefined, model: v.model }} />
        </article>
      ))}
    </section>
  );
};

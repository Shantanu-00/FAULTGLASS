import type { Connection } from '../state/PlantContext';
import type { Flag, IncidentDetail, PlantInfo, RunDiagnostics, TraceEvent } from '../types';

export interface CommanderEventInput {
  plant: PlantInfo | null;
  run: RunDiagnostics | null;
  flags: Flag[];
  incident: IncidentDetail | null;
  selectedIncidentId: string | null;
  connection: Connection;
}

export interface CommanderEvent {
  title: string;
  actor: string;
  detail?: string;
  tone: 'neutral' | 'accent' | 'warning' | 'ok';
  at?: string | null;
}

function eventDetail(text: string | null | undefined, fallback?: string): string | undefined {
  const sentence = (text || fallback || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z])/)[0];
  if (!sentence) return undefined;
  if (sentence.length <= 180) return sentence;
  return sentence.slice(0, 177).replace(/\s+\S*$/, '').replace(/[;,.:]$/, '') + '…';
}

/** Only the persisted verifier result supplies the historical recovery percentage. */
export function recordedRecoveryPercent(detail: IncidentDetail): string | null {
  if (detail.incident.status === 'open' || detail.incident.closed_by !== 'verifier') return null;
  const value = detail.incident.resolution?.match(/recovered to\s+([\d.]+)\s*%/i)?.[1];
  return value && Number.isFinite(Number(value)) ? value : null;
}

export function latestTrace(detail: IncidentDetail, predicate: (entry: TraceEvent) => boolean): TraceEvent | undefined {
  return [...detail.trace].sort((a, b) => b.seq - a.seq).find(predicate);
}

export function latestWonderNote(detail: IncidentDetail): TraceEvent | undefined {
  return latestTrace(detail, (entry) => entry.actor === 'model' && entry.kind === 'note'
    && Boolean(entry.content.trim()) && !/no visible conclusion|investigation started/i.test(entry.content));
}

// Starting an investigation or setting a goal is not evidence of a new finding.
// Keep Spark's detection visible until Wonder records evidence or a concrete next action.
export function hasWonderFindings(detail: IncidentDetail): boolean {
  return detail.hypotheses.some((hypothesis) => hypothesis.status !== 'open'
      || hypothesis.evidence_for.length > 0 || hypothesis.evidence_against.length > 0)
    || detail.field_tasks.length > 0 || detail.action_proposals.length > 0
    || Boolean(latestWonderNote(detail));
}

export function deriveCommanderEvent(input: CommanderEventInput): CommanderEvent {
  const { plant, run, flags, selectedIncidentId, connection } = input;
  const detail = input.incident?.incident.incident_id === selectedIncidentId ? input.incident : null;
  const flag = detail?.flag ?? [...flags].filter((item) => item.status !== 'dismissed' && item.status !== 'resolved')
    .sort((a, b) => Date.parse(b.raised_at) - Date.parse(a.raised_at))[0];

  if (connection === 'offline') return {
    title: 'Connection interrupted', actor: 'System', tone: 'warning',
    detail: 'Showing the last received state; reconnect before making a decision.',
  };
  if (!plant || connection === 'connecting') return {
    title: 'Connecting to the plant', actor: 'System', tone: 'neutral',
    detail: 'Live readings and incident details will appear when the connection is ready.',
  };
  if (selectedIncidentId && !detail) return {
    title: 'Loading the investigation', actor: 'System', tone: 'neutral',
    detail: eventDetail(flag?.summary, 'Retrieving the latest incident details.'), at: flag?.raised_at,
  };

  if (detail) {
    const base = detail.incident;
    if (base.status !== 'open') {
      const percentage = recordedRecoveryPercent(detail);
      const remaining = base.resolution?.split(/(?<=\.)\s+/).find((sentence) => /replace|inspect|recommend|maintenance/i.test(sentence));
      return {
        title: base.closed_by === 'verifier' ? `Recovery verified${percentage ? ` · ${percentage}% of baseline` : ''}` : 'Incident closed',
        actor: base.closed_by === 'verifier' ? 'Verifier' : 'Command', tone: 'ok',
        detail: eventDetail(remaining || base.resolution), at: base.closed_at,
      };
    }
    const failed = detail.action_proposals.find((proposal) => proposal.status === 'failed');
    if (failed) return {
      title: 'Recovery needs human review', actor: 'Verifier', tone: 'warning',
      detail: eventDetail(latestTrace(detail, (entry) => entry.kind === 'verification')?.content,
        'The action did not pass verification; review the recorded evidence.'),
      at: latestTrace(detail, (entry) => entry.kind === 'verification')?.at,
    };
    if (detail.investigation.status === 'escalated') return {
      title: 'Human review requested', actor: 'Muse Wonder', tone: 'warning',
      detail: eventDetail(detail.investigation.focus.blocker || latestWonderNote(detail)?.content,
        'The investigation needs an operator to review its findings.'),
      at: latestTrace(detail, (entry) => /escalat/i.test(entry.content))?.at,
    };
    const proposal = detail.action_proposals.find((item) => item.status === 'pending');
    if (proposal) return {
      title: proposal.action === 'backwash' ? 'Backwash proposed · approval required' : `${proposal.asset_id} action ready for approval`,
      actor: 'Muse Wonder', tone: 'accent',
      detail: eventDetail(proposal.rationale.includes(proposal.asset_id) ? proposal.rationale : `${proposal.asset_id}: ${proposal.rationale}`), at: proposal.created_at,
    };
    const valve = detail.field_tasks.find((task) => task.kind === 'valve_action' && task.status === 'pending');
    if (valve) {
      const retry = latestTrace(detail, (entry) => entry.kind === 'observation'
        && /^Valve clip (violated|uncertain)/i.test(entry.content) && Date.parse(entry.at) >= Date.parse(valve.created_at));
      return retry ? {
        title: 'A clearer valve clip is needed', actor: 'Verification', tone: 'warning', detail: eventDetail(retry.content), at: retry.at,
      } : {
        title: 'Approved · waiting for the worker', actor: 'Field', tone: 'accent',
        detail: `The worker must submit a continuous ${valve.asset_ids.join(', ') || 'valve'} clip proving the staged movement.`,
        at: latestTrace(detail, (entry) => entry.actor === 'operator' && entry.kind === 'action')?.at ?? valve.created_at,
      };
    }
    const executed = detail.action_proposals.find((item) => item.status === 'executed');
    const completedValve = detail.field_tasks.find((task) => task.kind === 'valve_action' && task.status === 'completed');
    if (executed || completedValve) return {
      title: 'Valve movement passed · checking recovery', actor: 'Verifier', tone: 'accent',
      detail: 'The staged action passed; live telemetry must confirm recovery before the incident can close.',
      at: completedValve?.completed_at ?? latestTrace(detail, (entry) => entry.kind === 'action' && entry.actor === 'code')?.at,
    };
    const field = detail.field_tasks.find((task) => task.status === 'pending');
    if (field) return {
      title: field.kind === 'gauge_photo' ? 'Waiting for gauge evidence' : 'Waiting for a field observation',
      actor: 'Muse Wonder', tone: 'accent',
      detail: field.kind === 'gauge_photo'
        ? eventDetail(field.tags.length ? `The worker has been asked to photograph ${field.tags.join(' and ')}.` : 'The worker has been asked to photograph the requested gauges.')
        : eventDetail(field.instruction), at: field.created_at,
    };
    const finding = [...detail.hypotheses].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .find((item) => item.status === 'supported' || item.status === 'confirmed');
    if (hasWonderFindings(detail)) return {
      title: detail.investigation.status === 'concluded' ? 'Investigation findings recorded' : 'Wonder is assessing the evidence',
      actor: 'Muse Wonder', tone: 'accent',
      detail: eventDetail(finding?.statement || latestWonderNote(detail)?.content || detail.investigation.focus.next_step,
        'Reviewing the evidence against the plant history and procedures.'),
      at: finding?.updated_at ?? latestWonderNote(detail)?.at,
    };
  }

  if (flag) {
    const evidence = 'evidence' in flag ? flag.evidence.signals?.['FIT-301'] : undefined;
    const flowMentioned = Boolean(evidence) || /product(?:ion)?\s+flow|permeate\s+flow|FIT-301/i.test(flag.summary);
    const flowDropped = evidence && Number.isFinite(evidence.current) && Number.isFinite(evidence.baseline) && evidence.current < evidence.baseline;
    return {
      title: flowDropped ? 'Spark detected a drop in product flow' : flowMentioned ? 'Spark detected abnormal product flow' : 'Spark detected abnormal drift',
      actor: 'Muse Spark Open', tone: 'warning', detail: eventDetail(flag.summary), at: flag.raised_at,
    };
  }
  if (run?.status === 'starting' || run?.status === 'learning') return {
    title: 'Learning the normal operating baseline', actor: 'Muse Spark Open', tone: 'accent',
    detail: 'Collecting the initial readings before monitoring for drift.', at: run.started_at,
  };
  if (run?.status === 'stopped') return {
    title: 'Plant feed stopped', actor: 'System', tone: 'neutral', detail: 'No active simulation is streaming.',
  };
  if (run?.scenario) return {
    title: 'Monitoring for emerging drift', actor: 'Muse Spark Open', tone: 'neutral',
    detail: 'The demo scenario is active; waiting for the watcher to report a finding.', at: run.scenario_started_at,
  };
  return {
    title: run || !plant.simulation ? 'Monitoring the plant' : 'Preparing the plant feed', actor: 'Muse Spark Open', tone: 'neutral',
    detail: 'No active drift flag; readings are monitored against the operating baseline.',
  };
}

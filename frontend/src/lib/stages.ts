import type { ActionProposal, Flag, IncidentDetail, IncidentSummary, RunDiagnostics } from '../types';

export type RunPhase = 'none' | 'learning' | 'normal' | 'blockage' | 'recovering' | 'closed';

export const PHASE_TEXT: Record<RunPhase, string> = {
  none: 'No active run',
  learning: 'Learning baseline',
  normal: 'Running normally',
  blockage: 'Blockage active',
  recovering: 'Recovering',
  closed: 'Incident closed',
};

export interface StageInput {
  run: RunDiagnostics | null;
  flags: Flag[];
  incident: IncidentDetail | null;
  summary: IncidentSummary | null;
}

const proposalOf = (incident: IncidentDetail | null, status: ActionProposal['status'][]) =>
  incident?.action_proposals.find((p) => status.includes(p.status)) ?? null;

export function isClosed(incident: IncidentDetail | null): boolean {
  return incident !== null && incident.incident.status !== 'open';
}

export function derivePhase({ run, incident }: StageInput): RunPhase {
  if (!run) return 'none';
  if (run.status === 'starting' || run.status === 'learning') return 'learning';
  if (isClosed(incident)) return 'closed';
  if (!run.scenario) return 'normal';
  const executed = proposalOf(incident, ['executed']);
  const clipPassed = incident?.field_tasks.some((t) => t.kind === 'valve_action' && t.status === 'completed') ?? false;
  return executed || clipPassed ? 'recovering' : 'blockage';
}

export type StageState = 'done' | 'current' | 'pending' | 'skipped';

export interface Stage {
  id: string;
  label: string;
  state: StageState;
  detail: string;
}

interface Draft {
  id: string;
  label: string;
  done: boolean;
  skipped?: boolean;
  detail: (state: StageState) => string;
}

export function deriveStages(input: StageInput): Stage[] {
  const { run, flags, incident, summary } = input;
  const hasIncident = incident !== null || summary !== null;
  const investigation = incident?.investigation.status ?? summary?.investigation_status ?? null;
  const gauge = incident?.field_tasks.filter((t) => t.kind === 'gauge_photo') ?? [];
  const valve = incident?.field_tasks.filter((t) => t.kind === 'valve_action') ?? [];
  const proposals = incident?.action_proposals ?? [];
  const approved = proposals.find((p) => ['approved', 'executed', 'failed'].includes(p.status)) ?? null;
  const pendingProposal = proposals.find((p) => p.status === 'pending') ?? null;
  const rejected = proposals.some((p) => p.status === 'rejected');
  const executed = proposals.some((p) => p.status === 'executed');
  const closed = isClosed(incident);
  const flagged = flags.length > 0 || hasIncident;
  const learning = run !== null && (run.status === 'starting' || run.status === 'learning');
  const gaugeDone = gauge.some((t) => t.status === 'completed');
  const valveDone = valve.some((t) => t.status === 'completed') || executed;
  const wonderMovedOn = gauge.length > 0 || proposals.length > 0 || closed || investigation === 'waiting_field' || investigation === 'awaiting_approval';

  const drafts: Draft[] = [
    {
      id: 'monitoring',
      label: 'Monitoring',
      done: flagged,
      detail: (s) => {
        if (s === 'done') return 'Telemetry watched';
        if (!run) return 'No run';
        if (learning) return 'Learning baseline';
        return run.scenario ? 'Waiting for the watcher' : 'Telemetry normal';
      },
    },
    {
      id: 'flag',
      label: 'Drift flagged',
      done: hasIncident,
      detail: (s) => {
        if (s === 'pending') return 'No flag yet';
        if (s === 'current') return flags.length ? 'Opening incident' : 'No flag yet';
        return flags[0]?.model ? `By ${flags[0].model.split('/').pop()}` : 'Flag raised';
      },
    },
    {
      id: 'investigating',
      label: 'Investigating',
      done: hasIncident && wonderMovedOn,
      detail: (s) => {
        if (s === 'pending') return 'Not started';
        if (s === 'done') return 'Evidence requested';
        if (investigation === 'escalated') return 'Escalated to a human';
        return investigation === 'not_started' || investigation === null ? 'Starting' : 'Working hypotheses';
      },
    },
    {
      id: 'gauge',
      label: 'Gauge check',
      done: gaugeDone,
      skipped: gauge.length === 0 && (proposals.length > 0 || closed),
      detail: (s) => {
        if (s === 'skipped') return 'Not requested';
        if (gaugeDone) return 'Photo received';
        if (gauge.some((t) => t.status === 'pending')) return 'Waiting for worker';
        return s === 'current' ? 'Waiting for a request' : 'Not requested yet';
      },
    },
    {
      id: 'approved',
      label: 'Action approved',
      done: approved !== null,
      detail: (s) => {
        if (approved) return approved.status === 'failed' ? 'Approved, check failed' : 'Approved';
        if (pendingProposal) return 'Awaiting your decision';
        if (rejected) return 'Rejected';
        return s === 'current' ? 'Waiting for a proposal' : 'No proposal yet';
      },
    },
    {
      id: 'valve',
      label: 'Valve staged',
      done: valveDone,
      detail: (s) => {
        if (valveDone) return 'Staged travel passed';
        if (valve.some((t) => t.status === 'pending')) return 'Waiting for lever clip';
        return s === 'current' ? 'Waiting for approval' : 'Not dispatched';
      },
    },
    {
      id: 'verified',
      label: 'Verified',
      done: closed,
      detail: (s) => {
        if (closed) return incident?.incident.closed_by ? `Closed by ${incident.incident.closed_by}` : 'Incident closed';
        return executed ? 'Verifier watching' : 'Not yet';
      },
    },
  ];

  let currentAssigned = false;
  return drafts.map((d) => {
    let state: StageState;
    if (d.done) state = 'done';
    else if (d.skipped) state = 'skipped';
    else if (!currentAssigned && run !== null) {
      state = 'current';
      currentAssigned = true;
    } else state = 'pending';
    return { id: d.id, label: d.label, state, detail: d.detail(state) };
  });
}

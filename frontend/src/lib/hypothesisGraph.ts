import type { Hypothesis, IncidentDetail } from '../types';

export type GraphTone = 'neutral' | 'open' | 'supported' | 'confirmed' | 'rejected' | 'action' | 'verified';
export type GraphLane = 'observations' | 'hypotheses' | 'response' | 'outcome';
export interface GraphSection { title: string; entries: string[] }
export interface HypothesisGraphNode {
  id: string;
  lane: GraphLane;
  title: string;
  eyebrow: string;
  summary: string;
  status: string;
  tone: GraphTone;
  at?: string | null;
  sections: GraphSection[];
}
export interface HypothesisGraphEdge {
  from: string;
  to: string;
  relation: 'recorded' | 'context';
  label: string;
}
export interface HypothesisGraph {
  nodes: HypothesisGraphNode[];
  edges: HypothesisGraphEdge[];
  verified: boolean;
}

export const hypothesisStatus = { open: 'Under review', supported: 'Supported', confirmed: 'Confirmed', rejected: 'Ruled out' } as const;
export const hypothesisOrder = { confirmed: 0, supported: 1, open: 2, rejected: 3 } as const;

export function evidenceText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return 'No detail recorded.';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function concise(value: string, max = 165): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

/** The map displays persisted records. Dashed context edges never assert a causal relationship. */
export function deriveHypothesisGraph(detail: IncidentDetail | undefined, items: Hypothesis[]): HypothesisGraph {
  const nodes: HypothesisGraphNode[] = [];
  const edges: HypothesisGraphEdge[] = [];
  const trace = [...(detail?.trace ?? [])].sort((a, b) => a.seq - b.seq);
  const flag = detail?.flag;
  if (flag) nodes.push({ id: 'spark', lane: 'observations', title: 'Spark detected a change', eyebrow: 'Muse Spark Open',
    summary: concise(flag.summary), status: 'Detection recorded', tone: 'action', at: flag.raised_at,
    sections: [{ title: 'Detection', entries: [flag.summary] },
      ...(flag.tags.length ? [{ title: 'Signals', entries: flag.tags }] : []),
      ...(flag.evidence ? [{ title: 'Recorded detection evidence', entries: [evidenceText(flag.evidence)] }] : [])] });

  const checks = trace.filter(entry => ['tool_result', 'recall', 'observation', 'human_result'].includes(entry.kind)
    && entry.tool_name !== 'record_hypothesis');
  const tasks = detail?.field_tasks.filter(task => task.status === 'completed') ?? [];
  const voices = detail?.voice_observations ?? [];
  if (checks.length || tasks.length || voices.length) {
    const latest = checks.at(-1);
    nodes.push({ id: 'evidence', lane: 'observations', title: 'Plant & field evidence', eyebrow: 'Recorded observations',
      summary: `${checks.length} returned checks · ${tasks.length} completed field tasks${voices.length ? ` · ${voices.length} voice observations` : ''}`,
      status: 'Evidence collected', tone: 'neutral', at: latest?.at ?? tasks.at(-1)?.completed_at,
      sections: [
        ...(checks.length ? [{ title: 'Returned checks & observations', entries: checks.map(entry => `${entry.tool_name ?? entry.kind} · ${entry.at}\n${entry.content}${entry.evidence.length ? `\nEvidence: ${evidenceText(entry.evidence)}` : ''}`) }] : []),
        ...(tasks.length ? [{ title: 'Completed field tasks', entries: tasks.map(task => `${task.kind} · ${task.asset_ids.join(', ')}\n${task.instruction}\n${evidenceText(task.result)}`) }] : []),
        ...(voices.length ? [{ title: 'Voice observations', entries: voices.map(voice => voice.transcript) }] : []),
      ] });
    if (flag) edges.push({ from: 'spark', to: 'evidence', relation: 'context', label: 'Collected during this investigation' });
  }
  if (!nodes.length) nodes.push({ id: 'no-evidence', lane: 'observations', title: 'Awaiting recorded observations',
    eyebrow: 'Plant evidence', summary: 'No detection or returned evidence is available in this record.', status: 'Not yet recorded', tone: 'neutral', sections: [] });

  const observations = nodes.filter(node => node.lane === 'observations');
  for (const hypothesis of [...items].sort((a, b) => hypothesisOrder[a.status] - hypothesisOrder[b.status] || a.label.localeCompare(b.label, undefined, { numeric: true }))) {
    const id = `hypothesis:${hypothesis.label}`;
    const history = trace.filter(entry => entry.hypothesis_id === hypothesis.label
      && (entry.tool_name === 'record_hypothesis' || entry.kind.startsWith('hypothesis')));
    const primary = hypothesis.status === 'rejected' ? hypothesis.evidence_against : hypothesis.evidence_for;
    nodes.push({ id, lane: 'hypotheses', title: hypothesis.statement, eyebrow: hypothesis.label,
      summary: primary.length ? concise(evidenceText(primary[0])) : hypothesis.status === 'rejected' ? 'No rejection reason was recorded.' : 'Evidence is still being assessed.',
      status: hypothesisStatus[hypothesis.status], tone: hypothesis.status, at: hypothesis.updated_at,
      sections: [
        { title: 'Supporting evidence', entries: hypothesis.evidence_for.map(evidenceText) },
        { title: 'Evidence against', entries: hypothesis.evidence_against.map(evidenceText) },
        ...(history.length ? [{ title: 'Recorded hypothesis updates · in time order', entries: history.map(entry => `${entry.at}\n${entry.content}`) }] : []),
      ] });
    const explicitlyLinked = checks.some(entry => entry.hypothesis_id === hypothesis.label);
    const from = observations.some(node => node.id === 'evidence') ? 'evidence' : observations[0].id;
    edges.push({ from, to: id, relation: explicitlyLinked ? 'recorded' : 'context',
      label: explicitlyLinked ? 'Hypothesis ID is attached to a returned check' : 'Reviewed in the same investigation; no direct evidence link recorded' });
  }
  if (!items.length) nodes.push({ id: 'no-hypotheses', lane: 'hypotheses', title: 'Wonder is building the case', eyebrow: 'Muse Wonder',
    summary: 'Possible causes appear here when Wonder saves a hypothesis.', status: 'No hypotheses recorded', tone: 'open', sections: [] });

  for (const proposal of detail?.action_proposals ?? []) {
    const id = `proposal:${proposal.id}`;
    nodes.push({ id, lane: 'response', title: `${proposal.action.replace(/_/g, ' ')} · ${proposal.asset_id}`,
      eyebrow: 'Action proposal', summary: concise(proposal.rationale), status: proposal.status === 'pending' ? 'Approval required' : proposal.status.replace(/^./, c => c.toUpperCase()),
      tone: proposal.status === 'rejected' || proposal.status === 'failed' ? 'rejected' : 'action', at: proposal.created_at,
      sections: [{ title: 'Recorded rationale', entries: [proposal.rationale] },
        ...(proposal.sop_id ? [{ title: 'Procedure', entries: [proposal.sop_id] }] : []),
        ...(proposal.result ? [{ title: 'Recorded action result', entries: [evidenceText(proposal.result)] }] : [])] });
    for (const hypothesis of items.filter(item => item.status === 'supported' || item.status === 'confirmed')) {
      edges.push({ from: `hypothesis:${hypothesis.label}`, to: id, relation: 'context', label: 'Supported hypothesis and proposal in the same incident; no explicit causal link recorded' });
    }
  }
  const valveTasks = detail?.field_tasks.filter(task => task.kind === 'valve_action') ?? [];
  for (const task of valveTasks) {
    const id = `task:${task.id}`;
    nodes.push({ id, lane: 'response', title: `Worker valve action${task.asset_ids.length ? ` · ${task.asset_ids.join(', ')}` : ''}`,
      eyebrow: 'Field task', summary: concise(task.instruction), status: task.status === 'pending' ? 'Waiting for worker' : task.status === 'completed' ? 'Field task completed' : 'Cancelled',
      tone: task.status === 'cancelled' ? 'neutral' : 'action', at: task.completed_at ?? task.created_at,
      sections: [{ title: 'Worker instruction', entries: [task.instruction] },
        ...(task.result ? [{ title: 'Recorded field result', entries: [evidenceText(task.result)] }] : [])] });
    const proposal = detail?.action_proposals.find(item => item.field_task_id === task.id);
    if (proposal) edges.push({ from: `proposal:${proposal.id}`, to: id, relation: 'recorded', label: 'Proposal links directly to this field task' });
  }
  if (!nodes.some(node => node.lane === 'response')) nodes.push({ id: 'no-response', lane: 'response', title: 'No valve action proposed',
    eyebrow: 'Response', summary: detail?.investigation.focus.next_step || 'The investigation remains open to further evidence.',
    status: detail?.investigation.status === 'escalated' ? 'Human review requested' : 'Awaiting a recorded response', tone: 'neutral', sections: [] });

  const incident = detail?.incident;
  const verified = Boolean(incident && incident.status !== 'open' && incident.closed_by === 'verifier');
  const verification = trace.filter(entry => entry.kind === 'verification');
  const failed = detail?.action_proposals.some(proposal => proposal.status === 'failed');
  nodes.push({ id: 'outcome', lane: 'outcome', title: verified ? 'Recovery verified' : incident && incident.status !== 'open' ? 'Incident closed' : failed ? 'Recovery not verified' : 'Outcome not yet verified',
    eyebrow: verified ? 'Verifier' : incident && incident.status !== 'open' ? 'Closure record' : 'Verification',
    summary: concise(incident?.resolution || (failed ? verification.at(-1)?.content : '') || 'A completed action alone does not confirm production recovery.'),
    status: verified ? 'Verified closure' : incident && incident.status !== 'open' ? 'Closed by ' + (incident.closed_by || 'unknown actor') : failed ? 'Review needed' : 'Unresolved',
    tone: verified ? 'verified' : failed ? 'rejected' : 'neutral', at: incident?.closed_at,
    sections: [
      ...(incident?.root_cause ? [{ title: 'Recorded root cause', entries: [incident.root_cause] }] : []),
      ...(incident?.resolution ? [{ title: 'Persisted resolution', entries: [incident.resolution] }] : []),
      ...(verification.length ? [{ title: 'Verification records', entries: verification.map(entry => `${entry.at}\n${entry.content}`) }] : []),
    ] });
  if (incident && incident.status !== 'open') {
    for (const node of nodes.filter(node => node.lane === 'response' && node.id !== 'no-response')) {
      edges.push({ from: node.id, to: 'outcome', relation: 'context', label: 'Action and closure recorded in the same incident' });
    }
  }
  return { nodes, edges, verified };
}

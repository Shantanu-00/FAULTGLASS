import type { FieldTask, IncidentDetail } from '../types';
import { hostOfTag, type PlantPack } from './plantPack';

const FITTING_KINDS = new Set(['tee', 'valve', 'header', 'drain']);

export type TargetRole = 'gauge' | 'valve' | 'focus';

export interface TargetGroup {
  role: TargetRole;
  label: string;
  codes: string[];
}

export interface TwinTargets {
  source: 'task' | 'proposal' | 'focus' | 'none';
  // The ring style the scene should use: tasks and proposals share one, focus has its own.
  kind: 'task' | 'focus';
  assets: string[];
  // Instrument tags are passed with the assets so the scene can show each dial's value chip.
  highlightIds: string[];
  // What the camera frames: the targets, plus the equipment a small target such as a valve is attached to.
  frame: string[];
  groups: TargetGroup[];
  key: string;
}

export const NO_TARGETS: TwinTargets = { source: 'none', kind: 'focus', assets: [], highlightIds: [], frame: [], groups: [], key: '' };

const ROLE_LABEL: Record<TargetRole, string> = {
  gauge: 'Gauge to read',
  valve: 'Valve to operate',
  focus: 'Investigator focus',
};

const unique = (items: string[]) => [...new Set(items)];

function framing(assets: string[], pack: PlantPack | null): string[] {
  if (!pack) return assets;
  const kindOf = new Map(pack.assets.map((a) => [a.id, a.kind]));
  const frame = new Set(assets);
  for (const id of assets) {
    if (kindOf.get(id) !== 'valve') continue;
    for (const edge of pack.edges) {
      const other = edge.from.asset === id ? edge.to.asset : edge.to.asset === id ? edge.from.asset : null;
      if (other && !FITTING_KINDS.has(kindOf.get(other) ?? '')) frame.add(other);
    }
  }
  return [...frame];
}

function fromTasks(tasks: FieldTask[], pack: PlantPack | null): TwinTargets {
  const groups: TargetGroup[] = [];
  const assets: string[] = [];
  const tags: string[] = [];
  for (const task of tasks) {
    const role: TargetRole = task.kind === 'valve_action' ? 'valve' : 'gauge';
    const hosts = pack ? task.tags.map((tag) => hostOfTag(pack, tag)).filter((h): h is string => Boolean(h)) : [];
    assets.push(...task.asset_ids, ...hosts);
    tags.push(...task.tags);
    const codes = role === 'gauge' && task.tags.length ? task.tags : unique([...task.asset_ids, ...hosts]);
    const existing = groups.find((g) => g.role === role);
    if (existing) existing.codes = unique([...existing.codes, ...codes]);
    else groups.push({ role, label: ROLE_LABEL[role], codes: unique(codes) });
  }
  return build('task', 'task', unique(assets), unique(tags), groups, pack);
}

function build(source: TwinTargets['source'], kind: TwinTargets['kind'], assets: string[], tags: string[], groups: TargetGroup[], pack: PlantPack | null): TwinTargets {
  const highlightIds = unique([...assets, ...tags]);
  const frame = framing(assets, pack);
  return { source, kind, assets, highlightIds, frame, groups, key: `${source}:${highlightIds.join(',')}:${frame.join(',')}` };
}

// Priority: pending field task targets, then a proposal still waiting on or in the field, then the
// investigator's focus assets.
export function deriveTargets(incident: IncidentDetail | null, pack: PlantPack | null): TwinTargets {
  if (!incident || incident.incident.status !== 'open') return NO_TARGETS;

  const pending = incident.field_tasks.filter((t) => t.status === 'pending');
  if (pending.length > 0) return fromTasks(pending, pack);

  const proposal = incident.action_proposals.find((p) => p.status === 'pending' || p.status === 'approved');
  if (proposal) return build('proposal', 'task', [proposal.asset_id], [], [{ role: 'valve', label: ROLE_LABEL.valve, codes: [proposal.asset_id] }], pack);

  const focus = incident.investigation.focus?.focus_assets ?? [];
  if (focus.length > 0) return build('focus', 'focus', unique(focus), [], [{ role: 'focus', label: ROLE_LABEL.focus, codes: unique(focus) }], pack);

  return NO_TARGETS;
}

export function flaggedHosts(pack: PlantPack | null, tags: string[]): string[] {
  if (!pack) return [];
  return unique(tags.map((tag) => hostOfTag(pack, tag)).filter((h): h is string => Boolean(h)));
}

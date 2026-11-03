import type { TraceEvent } from '../types';

const RECALL_LABEL: Record<string, string> = {
  recall_plant_memory: 'Plant memory',
  recall_sop: 'SOP',
  recall_incident: 'Past incident',
};

export interface Recall {
  seq: number;
  at: string;
  label: string;
  source: string | null;
  title: string | null;
  error: string | null;
}

function field(content: string, key: string): string | null {
  const match = content.match(new RegExp(`"${key}":\\s*"([^"]*)"`));
  return match ? match[1] : null;
}

export function toRecall(entry: TraceEvent): Recall {
  const content = entry.content;
  const tool = entry.tool_name ?? '';
  return {
    seq: entry.seq,
    at: entry.at,
    label: RECALL_LABEL[tool] ?? 'Memory',
    source: field(content, 'sop_id') ?? field(content, 'incident_id') ?? field(content, 'kind') ?? field(content, 'source'),
    title: field(content, 'title'),
    error: field(content, 'error'),
  };
}

export function actorLabel(entry: TraceEvent, models: { investigator: string | null; watcher: string | null }): string {
  switch (entry.actor) {
    case 'model':
      if (entry.tool_name === 'spark_watcher' || entry.kind === 'alarm') return models.watcher ?? 'Watcher model';
      return models.investigator ?? 'Investigator model';
    case 'operator':
      return 'Operator';
    case 'verifier':
      return 'Verifier';
    case 'code':
      return 'Code';
    default:
      return 'System';
  }
}

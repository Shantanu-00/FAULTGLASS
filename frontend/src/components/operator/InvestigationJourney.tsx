import React from 'react';
import { formatTime, humanize } from '../../lib/format';
import type { IncidentDetail, TraceEvent } from '../../types';

const ACTION_LABELS: Record<string, string> = {
  get_latest_telemetry: 'Read live measurements', get_telemetry_window: 'Compare the recent trend',
  get_signal_flag: 'Review Spark’s detection', recall_plant_memory: 'Read the plant architecture',
  recall_sop: 'Consult an operating procedure', recall_incident: 'Compare past incidents',
  get_asset_neighbours: 'Trace the connected equipment', record_hypothesis: 'Update a hypothesis',
  update_focus: 'Update the investigation plan', request_field_task: 'Request field evidence',
  request_field_evidence: 'Request field evidence', propose_action: 'Propose a corrective action',
  read_gauge_photo: 'Read the submitted gauge photos',
};
type Data = Record<string, unknown>;
function object(value: unknown): Data | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : null; }
function payload(content: string): Data | null {
  const start = content.indexOf('{');
  if (start < 0) return null;
  const end = content.lastIndexOf('}');
  try { return object(JSON.parse(content.slice(start, end + 1))); } catch { return null; }
}
// The backend bounds saved tool output. Read only complete string fields when
// truncation prevents parsing the full JSON; never guess a missing result.
function field(content: string, key: string): string | null {
  const match = content.match(new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`));
  if (!match) return null;
  try { return JSON.parse(match[1]) as string; } catch { return null; }
}
function text(value: unknown): string { return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''; }
function brief(content: string, max = 210): string {
  const value = content.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : value;
}
function outputSummary(result: TraceEvent, call?: TraceEvent): string {
  const data = payload(result.content);
  const args = call ? payload(call.content) : null;
  const error = text(data?.error) || field(result.content, 'error');
  if (error) return error === 'requires_field_task' ? 'This instrument has no live feed. A worker must collect the reading.' : `Could not complete: ${error}`;
  const tool = result.tool_name ?? call?.tool_name;
  if (tool === 'record_hypothesis') {
    const label = text(data?.recorded) || result.hypothesis_id || field(call?.content ?? '', 'label');
    const status = text(data?.status) || field(call?.content ?? '', 'status');
    if (label && status) return `${label} → ${status === 'rejected' ? 'ruled out' : status === 'open' ? 'under review' : status}.`;
  }
  if (tool === 'update_focus' && data?.focus_recorded) return brief(text(args?.next_step) || field(call?.content ?? '', 'next_step') || 'The investigation goal and next check were saved.');
  const created = object(data?.field_task_created);
  if (created) return brief(text(created.instruction) || `${humanize(text(created.kind))} requested from the worker.`);
  const proposed = object(data?.action_proposed);
  if (proposed) return `${humanize(text(proposed.action))} on ${text(proposed.asset_id)} · ${proposed.status === 'pending' ? 'awaiting approval' : text(proposed.status)}.`;
  if (data && Array.isArray(data.readings)) {
    const rows = data.readings.map(object).filter((row): row is Data => row !== null);
    if (rows.length) return brief(rows.slice(0, 3).map((row) => `${text(row.tag)} ${row.value === null ? 'unavailable' : `${text(row.value)} ${text(row.unit)}`.trim()}`).join(' · '));
    if (Array.isArray(data.field_only) && data.field_only.length) return 'The requested gauges need a field reading; they have no live feed.';
    return 'No matching live readings were returned.';
  }
  if (tool === 'get_telemetry_window' && data && typeof data.points === 'number') {
    return data.points > 0 ? `${text(data.tag)}: ${text(data.first)} → ${text(data.last)} ${text(data.unit)} across ${data.points} readings.` : `${text(data.tag)}: no readings in the requested window.`;
  }
  const title = text(data?.title) || field(result.content, 'title');
  if (title) return brief(title);
  if (tool === 'recall_sop' && Array.isArray(data?.sops)) return `${data.sops.length} matching operating procedure${data.sops.length === 1 ? '' : 's'} returned.`;
  if (tool === 'recall_incident' && Array.isArray(data?.past_incidents)) return `${data.past_incidents.length} past incident${data.past_incidents.length === 1 ? '' : 's'} returned for comparison.`;
  if (tool === 'get_asset_neighbours' && data) {
    const asset = object(data.asset);
    const upstream = Array.isArray(data.upstream) ? data.upstream.map(text).join(', ') : '';
    const downstream = Array.isArray(data.downstream) ? data.downstream.map(text).join(', ') : '';
    if (asset) return brief(`${text(asset.id)}${upstream ? ` · upstream: ${upstream}` : ''}${downstream ? ` · downstream: ${downstream}` : ''}`);
  }
  if (!result.content.includes('{')) return brief(result.content);
  const instruction = field(result.content, 'instruction');
  if (instruction) return brief(instruction);
  return 'Response recorded. Open the source record to inspect the returned detail.';
}

export interface InvestigationActivity { entry: TraceEvent; result?: TraceEvent; actor: string; label: string; summary: string; failed: boolean }
export function investigationActivities(trace: TraceEvent[]): InvestigationActivity[] {
  const sorted = [...trace].sort((a, b) => a.seq - b.seq);
  const consumed = new Set<number>();
  return sorted.flatMap((entry, index) => {
    if (consumed.has(entry.seq) || entry.kind === 'alarm' || entry.tool_name === 'spark_watcher'
      || /^(Investigation started|\(no visible conclusion\))/i.test(entry.content)) return [];
    let result: TraceEvent | undefined;
    if (entry.kind === 'tool_call' && entry.tool_name) {
      // Tool calls execute serially. Never pair a request with a result beyond
      // the next request, including another call to the same tool.
      for (let next = index + 1; next < sorted.length; next += 1) {
        const candidate = sorted[next];
        if (candidate.kind === 'tool_call') break;
        if (candidate.tool_name === entry.tool_name && candidate.actor === 'code') { result = candidate; consumed.add(candidate.seq); break; }
      }
    }
    const source = result ?? entry;
    const actor = entry.actor === 'operator' ? 'Field / command' : entry.actor === 'verifier' ? 'Verifier' : entry.actor === 'code' ? 'Evidence check' : entry.actor === 'model' ? 'Wonder' : 'System';
    const label = ACTION_LABELS[entry.tool_name ?? ''] ?? ({ human_task: 'Field evidence requested', human_result: 'Field evidence returned', observation: 'Evidence received', verification: 'Verify the outcome', hypothesis: 'Hypothesis updated', hypothesis_rejected: 'Hypothesis ruled out', note: entry.actor === 'model' ? 'Recorded assessment' : 'System update', action: 'Action recorded' }[entry.kind] || humanize(entry.tool_name || entry.kind));
    const pending = entry.kind === 'tool_call' && !result;
    return [{ entry, result, actor, label, summary: pending ? 'Request recorded; its result has not arrived yet.' : outputSummary(source, result ? entry : undefined), failed: Boolean(field(source.content, 'error')) }];
  });
}

const Activity: React.FC<{ activity: InvestigationActivity }> = ({ activity }) => <li className={`journey-activity${activity.failed ? ' is-failed' : ''}`}>
  <div className="journey-activity-head"><span>{activity.actor}</span><time dateTime={activity.entry.at}>{formatTime(activity.entry.at)}</time></div>
  <h4>{activity.label}</h4>
  <p className="journey-outcome"><span aria-hidden="true">↳</span>{activity.summary}</p>
  <details className="investigation-inline-details journey-source"><summary>Source record{activity.result ? ' · request & result' : ''}</summary>
    {activity.entry.tool_name && <code>{activity.entry.tool_name}</code>}
    <p className="activity-content">{activity.entry.content}</p>
    {activity.result && <><span className="investigation-meta-label">Returned result</span><p className="activity-content">{activity.result.content}</p></>}
    {(activity.result ?? activity.entry).evidence.length > 0 && <p className="investigation-meta">Evidence: {(activity.result ?? activity.entry).evidence.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' · ')}</p>}
  </details>
</li>;

export const InvestigationJourney: React.FC<{ detail: IncidentDetail }> = ({ detail }) => {
  const activities = investigationActivities(detail.trace);
  const latest = activities.slice(-1);
  const earlier = activities.slice(0, -1);
  const goal = detail.investigation.focus.goal;
  return <section className="investigation-card investigation-journey" aria-label="Connected investigation activity">
    <div className="investigation-card-head"><div><span className="investigation-eyebrow">Detection → investigation → evidence</span><h3>Investigation thread</h3></div><span className="journey-count">{activities.length} actions</span></div>
    <div className="journey-handoff">
      {detail.flag && <div className="journey-node journey-spark"><span className="journey-actor">Spark <small>Detected</small></span><p>{brief(detail.flag.summary, 170)}</p></div>}
      <div className="journey-node journey-wonder"><span className="journey-actor">Wonder <small>{detail.investigation.status === 'not_started' ? 'Preparing' : 'Investigation goal'}</small></span><p>{goal || 'The investigation has not recorded a goal yet.'}</p></div>
    </div>
    {latest.length > 0 ? <ol className="journey-actions">{latest.map((activity) => <Activity key={activity.entry.seq} activity={activity} />)}</ol> : <p className="investigation-meta">The first recorded investigation action will appear here.</p>}
    {earlier.length > 0 && <details className="journey-history"><summary>View {earlier.length} earlier action{earlier.length === 1 ? '' : 's'}<span aria-hidden="true">↗</span></summary><ol className="journey-actions">{earlier.map((activity) => <Activity key={activity.entry.seq} activity={activity} />)}</ol></details>}
  </section>;
};

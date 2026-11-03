import React, { useMemo } from 'react';
import { formatTime } from '../../lib/format';
import { signalState } from '../../lib/signals';
import { useNow } from '../../lib/useNow';
import { usePlant } from '../../state/PlantContext';
import type { SeriesPoint } from '../../types';
import { TrendPlot, useRetainedRunSeries, type TrendEvent } from './TrendPlot';
import '../../styles/telemetry.css';

const FLOW_TAG = 'FIT-301';
const EMPTY: SeriesPoint[] = [];

export const ProductionTrend: React.FC<{ onOpenMeasurements: () => void }> = ({ onOpenMeasurements }) => {
  const { plant, readings, series, run, runLoaded, baselines, flags, incident, connection } = usePlant();
  const now = useNow(1000);
  const signal = plant?.signals.find((item) => item.tag === FLOW_TAG);
  const reading = readings[FLOW_TAG];
  const runStart = run ? Date.parse(run.started_at) : -Infinity;
  const history = useRetainedRunSeries(series[FLOW_TAG] ?? EMPTY, run?.id ?? 'no-run', runStart);
  const currentReading = reading && (!run || !reading.run_id || reading.run_id === run.id) ? reading : undefined;
  const value = currentReading?.value ?? null;
  const baseline = baselines[FLOW_TAG];
  const reference = baseline && Number.isFinite(baseline.value) && baseline.value > 0 ? baseline.value : undefined;
  const points = useMemo(() => reference ? history.map((point) => ({ t: point.t, v: (point.v / reference) * 100 })) : history, [history, reference]);
  const pct = value !== null && reference ? (value / reference) * 100 : null;
  const stale = connection !== 'online' || (signal ? signalState(signal, currentReading, now) === 'stale' : true);
  const uncertain = currentReading?.quality === 'uncertain';
  const learning = run?.status === 'learning' || run?.status === 'starting';
  const status = !runLoaded || !plant ? 'Loading measurements' : value === null ? 'Waiting for readings' : stale ? 'Last reading · stale' : uncertain ? 'Uncertain reading' : 'Live reading';
  const events = useMemo(() => {
    const items: TrendEvent[] = [];
    if (run?.scenario_started_at) items.push({ id: 'decline', at: Date.parse(run.scenario_started_at), label: 'Decline started', tone: 'warning' });
    const firstFlag = flags.filter((flag) => flag.tags.includes(FLOW_TAG) && (!run || flag.run_id === run.id)).sort((a, b) => Date.parse(a.raised_at) - Date.parse(b.raised_at))[0];
    if (firstFlag) items.push({ id: firstFlag.id, at: Date.parse(firstFlag.raised_at), label: /spark/i.test(firstFlag.model ?? '') ? 'Spark flag raised' : 'Signal flag raised', tone: 'warning' });
    if (incident && Date.parse(incident.incident.opened_at) >= runStart) {
      for (const task of incident.field_tasks) {
        if (task.kind === 'valve_action' && task.status === 'completed' && task.completed_at) items.push({ id: task.id, at: Date.parse(task.completed_at), label: task.result?.policy?.status === 'passed' ? 'Valve action checked' : 'Valve task completed', tone: 'accent' });
      }
      if (incident.incident.closed_at) items.push({ id: 'closed', at: Date.parse(incident.incident.closed_at), label: 'Incident closed', tone: 'ok' });
    }
    return items;
  }, [run, flags, incident, runStart]);
  const unit = signal?.unit ?? 'L/h';
  const baselineLabel = baseline?.source === 'learned' ? 'Learned baseline' : 'Nominal reference';

  return <section className="production-trend" aria-labelledby="production-trend-title">
    <div className="production-heading"><div><h2 id="production-trend-title">Water production</h2></div><button className="btn production-measurements" type="button" aria-controls="plant-measurements" onClick={onOpenMeasurements}>All measurements <span aria-hidden="true">↗</span></button></div>
    <div className="production-summary"><div className="production-value"><strong>{value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong><span>{unit}</span>{pct !== null && <span className="production-percent">{pct.toFixed(1)}% of {baseline?.source === 'learned' ? 'baseline' : 'nominal'}</span>}</div><span className={`measurement-status${stale || uncertain ? ' is-muted' : ''}`} role="status"><i aria-hidden="true" />{status}</span></div>
    <TrendPlot points={points} label="Water production over time" unit={reference ? '% of baseline' : unit} domain={reference ? [0, 110] : signal?.range ?? [0, 5000]} yTickValues={reference ? [0, 25, 50, 75, 100] : undefined} baseline={reference ? 100 : undefined} baselineLabel={`${baselineLabel}${reference ? ' · 100%' : ''}`} events={events} height={210} gapThresholdMs={Math.max((signal?.freshness_s ?? 5) * 3000, 10_000)} tone={stale ? 'stale' : uncertain ? 'warning' : 'normal'} emptyMessage={!runLoaded || !plant ? 'Loading production history…' : 'Waiting for production samples. The graph will appear as readings arrive.'} />
    <div className="production-footnote"><span>{reference ? `${baselineLabel}: ${reference.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${unit}${learning ? ' · learning in progress' : ''}` : 'Baseline unavailable · showing measured flow'}</span><span>{currentReading ? `Last sample ${formatTime(currentReading.observed_at)}` : 'No sample received'}</span></div>
  </section>;
};

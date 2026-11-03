import React, { useMemo, useState } from 'react';
import { formatTime, humanize } from '../../lib/format';
import { plcStatus } from '../../lib/plc';
import { decimals, labelFor, signalState } from '../../lib/signals';
import { useNow } from '../../lib/useNow';
import { usePlant } from '../../state/PlantContext';
import type { Reading, SeriesPoint, Signal } from '../../types';
import { Icon } from '../common/Icon';
import { TrendPlot } from './TrendPlot';
import '../../styles/telemetry.css';

const EMPTY: SeriesPoint[] = [];
const NAMES: Record<string, string> = { 'FIT-301': 'Water production', 'PIT-301': 'Pump inlet pressure', 'PIT-302': 'Pump outlet pressure', 'JI-301': 'Pump motor current', 'AIT-301': 'Product water quality' };
const nameFor = (signal: Signal) => NAMES[signal.tag] ?? signal.name;

export const PlcStrip: React.FC = () => {
  const { plant, readings, connection } = usePlant();
  const now = useNow(1000);
  const status = useMemo(() => {
    if (!plant) return null;
    const certainReadings = Object.fromEntries(Object.entries(readings).filter(([, reading]) => reading.quality !== 'uncertain'));
    return plcStatus(plant.signals, certainReadings, now);
  }, [plant, readings, now]);
  if (!status) return <div className="plc-strip is-unknown" role="status">Loading controller status…</div>;
  const unknown = connection !== 'online' ? status.watched : status.unknown;
  const active = connection === 'online' && status.active.length > 0;
  const text = active ? `${status.active.length} controller alarm${status.active.length === 1 ? '' : 's'} active` : unknown ? 'Controller alarm status incomplete' : status.watched ? 'No controller alarms active' : 'No controller alarm conditions configured';
  return <div className={`plc-strip ${active ? 'is-active' : unknown ? 'is-unknown' : 'is-clear'}`} role="status">
    <Icon name={active || unknown ? 'alert' : 'check'} size={18} />
    <div><strong>{text}</strong><span className="plc-sub">{active ? `${status.active.map((item) => item.tag).join(', ')} · ` : ''}{unknown ? `${unknown} of ${status.watched} alarm conditions lack current readings` : `${status.watched} alarm conditions checked`}</span></div>
  </div>;
};

const StateCell: React.FC<{ signal: Signal; reading: Reading | undefined; now: number; offline: boolean }> = ({ signal, reading, now, offline }) => {
  const state = offline ? 'stale' : signalState(signal, reading, now);
  const label = reading?.value !== null && reading?.value !== undefined ? labelFor(signal, reading.value) : undefined;
  const missing = !reading || reading.value === null;
  const text = missing ? 'No reading' : label ? humanize(label) : String(reading.value);
  return <div className={`equipment-state state-${state}`} data-tag={signal.tag}>
    <div><strong>{signal.name}</strong><code>{signal.tag}</code></div>
    <span>{text}{!missing && state === 'stale' ? ' · stale' : reading?.quality === 'uncertain' ? ' · uncertain' : ''}</span>
  </div>;
};

export const TelemetryPanel: React.FC = () => {
  const { plant, readings, series, flags, connection, run, runLoaded, baselines } = usePlant();
  const [selectedTag, setSelectedTag] = useState('FIT-301');
  const now = useNow(1000);
  const measurements = plant?.signals.filter((signal) => signal.type === 'measurement') ?? [];
  const discrete = plant?.signals.filter((signal) => signal.type !== 'measurement') ?? [];
  const selected = measurements.find((signal) => signal.tag === selectedTag) ?? measurements[0];
  const flagged = new Set(flags.filter((flag) => flag.status !== 'resolved' && flag.status !== 'dismissed').flatMap((flag) => flag.tags));
  const reading = selected ? readings[selected.tag] : undefined;
  const state = selected ? signalState(selected, reading, now) : 'stale';
  const baseline = selected ? baselines[selected.tag] : undefined;
  const value = reading?.value ?? null;
  const offline = connection !== 'online';
  const stale = offline || state === 'stale';
  const points = selected ? (series[selected.tag] ?? EMPTY).filter((point) => !run || point.t >= Date.parse(run.started_at)) : EMPTY;
  const chartDomain = useMemo<[number, number]>(() => {
    if (!selected) return [0, 100];
    const values = points.map((point) => point.v).filter(Number.isFinite);
    if (baseline && Number.isFinite(baseline.value)) values.push(baseline.value);
    if (value !== null && Number.isFinite(value)) values.push(value);
    if (!values.length) return selected.range;
    const low = Math.min(...values);
    const high = Math.max(...values);
    const padding = Math.max((high - low) * .18, Math.abs(baseline?.value ?? high) * .025, (selected.range[1] - selected.range[0]) * .002);
    return [low >= selected.range[0] ? Math.max(selected.range[0], low - padding) : low - padding, high + padding];
  }, [selected, points, baseline, value]);
  const limits = selected ? Object.entries(selected.limits).filter(([name]) => name !== 'nominal').map(([name, threshold]) => `${humanize(name)} ${threshold} ${selected.unit}`) : [];

  if (!plant) return <div className="measurements-panel" role="status">Loading plant measurements…</div>;
  return <div className="measurements-panel">
    <PlcStrip />
    <p className="measurements-intro">Select a measurement to see its trend.</p>
    <div className="measurement-options" aria-label="Choose a measurement">
      {measurements.map((signal) => {
        const latest = readings[signal.tag];
        const currentState = offline ? 'stale' : signalState(signal, latest, now);
        return <button key={signal.tag} type="button" className={`measurement-option${selected?.tag === signal.tag ? ' is-selected' : ''} state-${currentState}`} aria-pressed={selected?.tag === signal.tag} onClick={() => setSelectedTag(signal.tag)}>
          <span className="measurement-option-name">{nameFor(signal)}{flagged.has(signal.tag) && <span className="measurement-flag">Flagged</span>}</span>
          <span className="measurement-option-detail"><code>{signal.tag}</code><strong>{latest?.value === null || latest?.value === undefined ? '—' : latest.value.toFixed(decimals(signal))}<small>{signal.unit}</small></strong></span>
          {currentState === 'stale' && <span className="measurement-option-status">{latest ? 'Last reading · stale' : 'Waiting for reading'}</span>}
        </button>;
      })}
    </div>
    {selected && <section className="selected-measurement" aria-label={`${nameFor(selected)} details`}>
      <div className="selected-measurement-heading"><div><h3>{nameFor(selected)}</h3><code>{selected.tag}</code></div><div className="selected-measurement-value"><strong>{value === null ? '—' : value.toFixed(decimals(selected))}</strong><span>{selected.unit}</span></div></div>
      <p className={`selected-measurement-status${stale ? ' is-muted' : ''}`} role="status">{value === null ? 'Waiting for a reading' : stale ? `Last known reading · ${formatTime(reading?.observed_at)}` : reading?.quality === 'uncertain' ? 'Reading quality is uncertain' : `Latest sample ${formatTime(reading?.observed_at)}`}{!stale && state !== 'ok' ? ` · ${humanize(state)}` : ''}</p>
      <TrendPlot points={points} label={`${nameFor(selected)} over time`} unit={selected.unit} domain={chartDomain} baseline={baseline?.value} baselineLabel={baseline?.source === 'learned' ? 'Learned baseline' : 'Nominal reference'} height={225} gapThresholdMs={Math.max((selected.freshness_s ?? 5) * 3000, 10_000)} tone={stale ? 'stale' : state === 'alarm' ? 'alarm' : state === 'warning' ? 'warning' : 'normal'} emptyMessage={!runLoaded ? 'Loading measurement history…' : 'No history received for this measurement yet.'} />
      <p className="measurement-chart-note">{baseline ? `${baseline.source === 'learned' ? 'Learned baseline' : 'Plant nominal'}: ${baseline.value.toFixed(decimals(selected))} ${selected.unit}. ` : 'No baseline available. '}{run?.status === 'learning' || run?.status === 'starting' ? 'Learning in progress.' : 'Axis fitted to the received readings.'}</p>
      {limits.length > 0 && <p className="measurement-limits">Controller limits: {limits.join(' · ')}</p>}
    </section>}
    <section className="equipment-states" aria-labelledby="equipment-states-title"><div className="equipment-states-heading"><h3 id="equipment-states-title">Equipment and controller states</h3><span>{discrete.length} signals</span></div><div className="equipment-state-list">{discrete.map((signal) => <StateCell key={signal.tag} signal={signal} reading={readings[signal.tag]} now={now} offline={offline} />)}</div></section>
  </div>;
};

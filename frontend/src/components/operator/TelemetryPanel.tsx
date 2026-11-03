import React, { useMemo } from 'react';
import { humanize } from '../../lib/format';
import { plcStatus } from '../../lib/plc';
import { decimals, groupSignals, labelFor, signalState, type SignalState } from '../../lib/signals';
import { useNow } from '../../lib/useNow';
import { type Baseline, usePlant } from '../../state/PlantContext';
import type { Reading, SeriesPoint, Signal } from '../../types';
import { Icon } from '../common/Icon';
import { Sparkline } from './Sparkline';

// A reading this far from its baseline is shown as drifting. It is a display aid, not an alarm.
const DRIFT_PCT = 2;
const EMPTY: SeriesPoint[] = [];

const STATE_TEXT: Record<SignalState, string> = { ok: '', warning: 'Warning', alarm: 'Alarm', stale: 'No data' };

function limitNote(signal: Signal): string | null {
  const l = signal.limits;
  const parts: string[] = [];
  if (l.low_trip !== undefined) parts.push(`low trip ${l.low_trip}`);
  if (l.low_alarm !== undefined) parts.push(`low alarm ${l.low_alarm}`);
  if (l.high_alarm !== undefined) parts.push(`high alarm ${l.high_alarm}`);
  if (l.high_trip !== undefined) parts.push(`high trip ${l.high_trip}`);
  return parts.length ? `PLC ${parts.join(', ')} ${signal.unit}` : null;
}

const Delta: React.FC<{ signal: Signal; value: number; baseline: Baseline; learning: boolean }> = ({ signal, value, baseline, learning }) => {
  if (learning) return <span className="delta delta-quiet">Learning</span>;
  const pct = baseline.value ? ((value - baseline.value) / baseline.value) * 100 : 0;
  const drifting = Math.abs(pct) >= DRIFT_PCT;
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '';
  const text = `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(1)}%`;
  return (
    <span
      className={`delta${drifting ? ' is-drift' : ''}`}
      title={`${baseline.source === 'learned' ? 'Learned baseline' : 'Nominal value from the plant pack'} ${baseline.value.toFixed(decimals(signal))} ${signal.unit}`}
    >
      {drifting && (
        <span className="delta-arrow" aria-hidden="true">
          {arrow}
        </span>
      )}
      {text}
      <span className="visually-hidden">{drifting ? (pct > 0 ? ' above baseline' : ' below baseline') : ' of baseline'}</span>
    </span>
  );
};

interface MeasurementProps {
  signal: Signal;
  reading: Reading | undefined;
  points: SeriesPoint[];
  baseline: Baseline | undefined;
  now: number;
  flagged: string | null;
  learning: boolean;
  markAt: number | null;
}

const MeasurementRow: React.FC<MeasurementProps> = React.memo(({ signal, reading, points, baseline, now, flagged, learning, markAt }) => {
  const state = signalState(signal, reading, now);
  const value = reading?.value ?? null;
  const spread = Math.max((signal.range[1] - signal.range[0]) * 0.01, Math.abs(baseline?.value ?? 0) * 0.03);
  const limits = limitNote(signal);
  const pct = value !== null && baseline?.value ? ((value - baseline.value) / baseline.value) * 100 : 0;
  const drifting = !learning && Math.abs(pct) >= DRIFT_PCT;

  return (
    <div className={`m-row state-${state}${flagged ? ' is-flagged' : ''}${drifting ? ' is-drifting' : ''}`} data-tag={signal.tag} title={limits ?? undefined}>
      <div className="m-id">
        <code className="tag">{signal.tag}</code>
        {value !== null && baseline ? <Delta signal={signal} value={value} baseline={baseline} learning={learning} /> : <span className="delta delta-quiet">No baseline</span>}
        {state !== 'ok' && <span className={`m-state note-${state}`}>{STATE_TEXT[state]}</span>}
      </div>
      <div className="m-val">
        <span className="m-num">{value === null ? '-' : value.toFixed(decimals(signal))}</span>
        <span className="m-unit">{signal.unit}</span>
      </div>
      <div className="m-sub">
        <span className="m-name">{signal.name}</span>
        {baseline && <span className="delta-base">{baseline.source === 'learned' ? 'base' : 'nominal'} {baseline.value.toFixed(decimals(signal))}</span>}
      </div>
      <div className="m-spark">
        <Sparkline
          points={points}
          baseline={baseline?.value}
          spread={spread}
          markAt={markAt}
          label={`${signal.tag} last five minutes`}
          tone={state === 'alarm' ? 'alarm' : state === 'warning' || drifting || flagged ? 'warning' : state === 'stale' ? 'stale' : 'normal'}
        />
      </div>
    </div>
  );
});

const StateCell: React.FC<{ signal: Signal; reading: Reading | undefined; now: number; flagged: string | null }> = ({ signal, reading, now, flagged }) => {
  const state = signalState(signal, reading, now);
  const label = reading && reading.value !== null ? labelFor(signal, reading.value) : undefined;
  const text = reading?.value === null || !reading ? 'No data' : label ? humanize(label) : String(reading.value);
  return (
    <div className={`s-cell state-${state}${flagged ? ' is-flagged' : ''}`} title={signal.name} data-tag={signal.tag}>
      <code className="tag">{signal.tag}</code>
      <span className="s-text">{text}</span>
    </div>
  );
};

export const PlcStrip: React.FC = () => {
  const { plant, readings } = usePlant();
  const now = useNow(1000);
  const status = useMemo(() => (plant ? plcStatus(plant.signals, readings, now) : null), [plant, readings, now]);
  if (!status) return null;
  const none = status.active.length === 0;
  return (
    <div className={`plc-strip ${none ? 'is-clear' : 'is-active'}`} role="status">
      <span className="plc-icon" aria-hidden="true">
        <Icon name={none ? 'check' : 'alert'} size={18} />
      </span>
      <div>
        <strong>{none ? 'PLC alarms: none' : `PLC alarms: ${status.active.map((a) => a.tag).join(', ')}`}</strong>
        <span className="plc-sub">
          {status.watched} alarm conditions watched
          {status.unknown > 0 ? `, ${status.unknown} without current data` : ''}
        </span>
      </div>
    </div>
  );
};

export const TelemetryPanel: React.FC = () => {
  const { plant, readings, series, flags, connection, run, baselines } = usePlant();
  const now = useNow(1000);
  const groups = useMemo(() => (plant ? groupSignals(plant.signals) : []), [plant]);

  const flaggedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const flag of flags) {
      if (flag.status === 'resolved' || flag.status === 'dismissed') continue;
      for (const tag of flag.tags) map.set(tag, flag.model ?? 'signal flag');
    }
    return map;
  }, [flags]);

  if (!plant) return null;
  const stale = connection === 'offline';
  const learning = !run || run.status === 'starting' || run.status === 'learning';
  const markAt = run?.scenario_started_at ? Date.parse(run.scenario_started_at) : null;
  const measurements = plant.signals.filter((s) => s.type === 'measurement');
  const discrete = groups.flatMap((g) => g.signals.filter((sig) => sig.type !== 'measurement'));
  const drifting = measurements.filter((s) => {
    const value = readings[s.tag]?.value;
    const base = baselines[s.tag];
    return !learning && value !== null && value !== undefined && base && base.value && Math.abs(((value - base.value) / base.value) * 100) >= DRIFT_PCT;
  });

  return (
    <div className={`telemetry${stale ? ' is-stale' : ''}`}>
      <PlcStrip />
      <p className="drift-line" role="status">
        {learning
          ? 'Learning the baseline for each streamed measurement.'
          : drifting.length === 0
            ? `All ${measurements.length} streamed measurements are within ${DRIFT_PCT}% of baseline.`
            : `${drifting.length} of ${measurements.length} streamed measurements are off baseline: ${drifting.map((s) => s.tag).join(', ')}.`}
      </p>
      {groups.map(
        (group) =>
          group.signals.some((sig) => sig.type === 'measurement') && (
            <section className="t-group" key={group.title} aria-label={group.title}>
              <h3 className="t-title">{group.title}</h3>
              {group.signals
                .filter((sig) => sig.type === 'measurement')
                .map((signal) => (
                  <MeasurementRow
                    key={signal.tag}
                    signal={signal}
                    reading={readings[signal.tag]}
                    points={series[signal.tag] ?? EMPTY}
                    baseline={baselines[signal.tag]}
                    now={now}
                    flagged={flaggedBy.get(signal.tag) ?? null}
                    learning={learning}
                    markAt={markAt}
                  />
                ))}
            </section>
          ),
      )}
      <section className="t-group" aria-label="PLC switches and equipment states">
        <h3 className="t-title">PLC switches and equipment states</h3>
        <div className="s-grid">
          {discrete.map((signal) => (
            <StateCell key={signal.tag} signal={signal} reading={readings[signal.tag]} now={now} flagged={flaggedBy.get(signal.tag) ?? null} />
          ))}
        </div>
      </section>
    </div>
  );
};

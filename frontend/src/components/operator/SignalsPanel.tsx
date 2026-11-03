import React, { useMemo } from 'react';
import { decimals, groupSignals, labelFor, signalState, type SignalState } from '../../lib/signals';
import { humanize } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { usePlant } from '../../state/PlantContext';
import type { Reading, Signal, SeriesPoint } from '../../types';
import { Sparkline } from './Sparkline';

const STATE_TEXT: Record<SignalState, string> = { ok: '', warning: 'Warning', alarm: 'Alarm', stale: 'No current data' };

function display(signal: Signal, reading: Reading | undefined): { text: string; unit: string } {
  if (!reading || reading.value === null) return { text: 'No data', unit: '' };
  if (signal.type !== 'measurement') {
    const label = labelFor(signal, reading.value);
    return { text: label ? humanize(label) : String(reading.value), unit: '' };
  }
  return { text: reading.value.toFixed(decimals(signal)), unit: signal.unit };
}

interface RowProps {
  signal: Signal;
  reading: Reading | undefined;
  points: SeriesPoint[];
  now: number;
  flagged: string | null;
}

const SignalRow: React.FC<RowProps> = React.memo(({ signal, reading, points, now, flagged }) => {
  const state = signalState(signal, reading, now);
  const shown = display(signal, reading);
  const nominal = signal.limits.nominal;
  const spread = Math.max((signal.range[1] - signal.range[0]) * 0.02, Math.abs(nominal ?? 0) * 0.03);
  const note = state !== 'ok' ? STATE_TEXT[state] : flagged ? 'Flagged' : '';

  return (
    <div className={`signal-row state-${state}${flagged ? ' is-flagged' : ''}${signal.type === 'measurement' ? '' : ' no-spark'}`} data-tag={signal.tag}>
      <div className="signal-id">
        <span className="signal-name">{signal.name}</span>
        <code className="tag">{signal.tag}</code>
      </div>
      <div className="signal-reading">
        <span className={`signal-value${signal.type === 'measurement' ? ' is-number' : ''}`}>{shown.text}</span>
        {shown.unit && <span className="signal-unit">{shown.unit}</span>}
        {note && (
          <span className={`signal-note${state === 'ok' ? ' note-flagged' : ` note-${state}`}`} title={flagged ?? undefined}>
            {note}
          </span>
        )}
      </div>
      {signal.type === 'measurement' && (
        <Sparkline
          points={points}
          nominal={nominal}
          spread={spread}
          tone={state === 'alarm' ? 'alarm' : state === 'warning' || flagged ? 'warning' : state === 'stale' ? 'stale' : 'normal'}
        />
      )}
    </div>
  );
});

export const SignalsPanel: React.FC = () => {
  const { plant, readings, series, flags, connection } = usePlant();
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

  return (
    <div className={`signal-groups${stale ? ' is-stale' : ''}`}>
      {groups.map((group) => (
        <section className="panel signal-group" key={group.title} aria-label={group.title}>
          <h2 className="panel-title">{group.title}</h2>
          {group.signals.map((signal) => (
            <SignalRow
              key={signal.tag}
              signal={signal}
              reading={readings[signal.tag]}
              points={series[signal.tag] ?? EMPTY}
              now={now}
              flagged={flaggedBy.get(signal.tag) ?? null}
            />
          ))}
        </section>
      ))}
    </div>
  );
};

const EMPTY: SeriesPoint[] = [];

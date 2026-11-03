import React from 'react';
import { formatTime } from '../../lib/format';
import { signalState } from '../../lib/signals';
import { useNow } from '../../lib/useNow';
import { usePlant } from '../../state/PlantContext';
import '../../styles/telemetry.css';

const INSTRUMENTS = [
  { tag: 'FIT-301', name: 'Water production', unit: 'L/h', digits: 0 },
  { tag: 'PIT-301', name: 'Pump inlet pressure', unit: 'psi', digits: 1 },
  { tag: 'JI-301', name: 'Motor current', unit: 'A', digits: 1 },
  { tag: 'AIT-301', name: 'Product water TDS', unit: 'ppm', digits: 1 },
] as const;

export const PlantReadings: React.FC<{ onOpenMeasurements: () => void }> = ({ onOpenMeasurements }) => {
  const { plant, readings, baselines, run, connection } = usePlant();
  const now = useNow(1000);

  return <section className="plant-readings" aria-label="Live plant instruments">
    {INSTRUMENTS.map((instrument) => {
      const signal = plant?.signals.find((item) => item.tag === instrument.tag);
      const latest = readings[instrument.tag];
      const reading = latest && (!run || !latest.run_id || latest.run_id === run.id) ? latest : undefined;
      const available = !!reading && reading.value !== null && Number.isFinite(reading.value) && reading.quality !== 'bad';
      const value = available ? reading.value! : null;
      const state = signal ? signalState(signal, reading, now) : 'stale';
      const stale = connection !== 'online' || state === 'stale' || !Number.isFinite(Date.parse(reading?.observed_at ?? ''));
      const uncertain = !!reading && !['good', 'bad', 'stale'].includes(reading.quality);
      const baseline = baselines[instrument.tag];
      const reference = baseline && Number.isFinite(baseline.value) && baseline.value > 0 ? baseline.value : null;
      const comparable = value !== null && !stale && !uncertain && reference !== null;
      const referenceName = baseline?.source === 'learned' ? 'baseline' : 'nominal';
      const delta = comparable ? ((value! - reference!) / reference!) * 100 : null;
      const quality = !plant ? 'Loading' : !available ? reading?.quality === 'bad' ? 'Invalid sample' : 'Awaiting sample' : stale ? 'Stale sample' : uncertain ? reading?.quality === 'uncertain' ? 'Uncertain' : 'Quality unknown' : 'Live';
      const comparison = comparable
        ? instrument.tag === 'FIT-301'
          ? `${((value! / reference!) * 100).toFixed(1)}% of ${referenceName}`
          : `${delta! > 0 ? '+' : ''}${delta!.toFixed(1)}% vs ${referenceName}`
        : reference !== null ? `${referenceName === 'baseline' ? 'Baseline' : 'Nominal'} ${reference.toLocaleString(undefined, { maximumFractionDigits: instrument.digits })}` : 'Baseline pending';

      return <button key={instrument.tag} type="button" className={`plant-instrument${instrument.tag === 'FIT-301' ? ' is-production' : ''} state-${stale ? 'stale' : state}${uncertain ? ' is-uncertain' : ''}`} onClick={onOpenMeasurements} aria-controls="plant-measurements" aria-label={`${instrument.name}: ${value === null ? 'no valid reading' : `${value.toLocaleString(undefined, { maximumFractionDigits: instrument.digits })} ${signal?.unit ?? instrument.unit}`}. ${quality}. View all measurements.`}>
        <span className="plant-instrument-heading"><span>{instrument.name}</span><code>{instrument.tag}</code></span>
        <span className="plant-instrument-reading"><strong>{value === null ? '—' : value.toLocaleString(undefined, { minimumFractionDigits: instrument.digits, maximumFractionDigits: instrument.digits })}</strong><span>{signal?.unit ?? instrument.unit}</span></span>
        <span className="plant-instrument-comparison">{comparison}</span>
        <span className="plant-instrument-meta"><span><i aria-hidden="true" />{quality}</span>{reading && Number.isFinite(Date.parse(reading.observed_at)) && <time dateTime={reading.observed_at}>{formatTime(reading.observed_at)}</time>}</span>
      </button>;
    })}
  </section>;
};

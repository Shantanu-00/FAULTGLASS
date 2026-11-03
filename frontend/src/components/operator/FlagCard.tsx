import React from 'react';
import { decimals } from '../../lib/signals';
import { formatTime, humanize } from '../../lib/format';
import { usePlant } from '../../state/PlantContext';
import type { Flag, IncidentDetail } from '../../types';
import { Pill, type Tone } from '../common/Pill';
const SEVERITY_TONE: Record<string, Tone> = { info: 'neutral', warning: 'warning', critical: 'alarm' };

export const FlagCard: React.FC<{ flag: Flag | NonNullable<IncidentDetail['flag']> }> = ({ flag }) => {
  const { plant } = usePlant();
  const evidence = 'evidence' in flag ? flag.evidence?.signals : undefined;
  const values = Object.entries(evidence ?? {});
  const signalFor = (tag: string) => plant?.signals.find((signal) => signal.tag === tag);
  const formatValue = (tag: string, value: number) => Number.isFinite(value) ? value.toFixed(signalFor(tag) ? decimals(signalFor(tag)!) : 1) : '—';
  return <section className="investigation-card detection-card" aria-label="Spark detection">
    <div className="investigation-card-head"><span className="investigation-eyebrow">Spark · drift detection</span><Pill tone={SEVERITY_TONE[flag.severity] ?? 'neutral'}>{humanize(flag.severity)}</Pill></div>
    <h3>Abnormal drift detected</h3><p className="detection-summary">{flag.summary}</p>
    {values.length > 0 ? <div className="detection-signals">
      {values.map(([tag, reading]) => <div className="detection-signal" key={tag}>
        <div><span className="detection-signal-name">{signalFor(tag)?.name ?? tag}</span><code>{tag}</code></div>
        <div className="detection-values"><strong>{formatValue(tag, Number(reading.current))}<small> {reading.unit || signalFor(tag)?.unit}</small></strong><span className="detection-change">{reading.pct > 0 ? '+' : reading.pct < 0 ? '−' : ''}{Math.abs(reading.pct).toFixed(1)}%</span></div>
        <span className="detection-baseline">Baseline {formatValue(tag, Number(reading.baseline))} {reading.unit || signalFor(tag)?.unit}</span>
      </div>)}
    </div> : <div className="investigation-tags">{flag.tags.map((tag) => <span key={tag}>{signalFor(tag)?.name ?? tag} <code>{tag}</code></span>)}</div>}
    <div className="investigation-card-foot"><span>Detected by Spark</span><time dateTime={flag.raised_at}>{formatTime(flag.raised_at)}</time></div>
    {values.length > 0 && <details className="investigation-inline-details">
      <summary>Detection details</summary><p className="investigation-meta">Baseline comparison is calculated from the readings; Spark classifies the drift.{flag.model ? ` Model: ${flag.model}.` : ''}</p>
      <ul className="investigation-meta-list">{values.map(([tag, reading]) => <li key={tag}>{tag}: {Number(reading.sigma).toFixed(1)} standard deviations from baseline</li>)}</ul>
    </details>}
  </section>;
};

import React, { useMemo } from 'react';
import { recordedRecoveryPercent } from '../../lib/commander';
import { formatDateTime } from '../../lib/format';
import { signalState } from '../../lib/signals';
import { useNow } from '../../lib/useNow';
import { usePlant } from '../../state/PlantContext';
import type { IncidentDetail } from '../../types';
import { Pill } from '../common/Pill';

const FLOW_TAG = 'FIT-301';
const RECENT_MS = 5000;

export const ClosedResult: React.FC<{ detail: IncidentDetail }> = ({ detail }) => {
  const { readings, series, baselines, plant, connection } = usePlant();
  const now = useNow(1000);
  const base = detail.incident;
  const signal = plant?.signals.find((item) => item.tag === FLOW_TAG);
  const baseline = baselines[FLOW_TAG];
  const reading = readings[FLOW_TAG];
  const fresh = connection === 'online' && reading?.quality === 'good' && (signal ? signalState(signal, reading, now) !== 'stale' : now - Date.parse(reading.observed_at) < 15000);
  const current = useMemo(() => {
    const points = series[FLOW_TAG] ?? [];
    const last = points.at(-1)?.t ?? 0;
    const recent = points.filter((point) => point.t >= last - RECENT_MS);
    const value = recent.length ? recent.reduce((sum, point) => sum + point.v, 0) / recent.length : reading?.value;
    if (value == null || !Number.isFinite(value) || !baseline?.value) return null;
    return { value, pct: value / baseline.value * 100 };
  }, [series, reading, baseline]);
  const verified = base.closed_by === 'verifier';
  const recordedPercent = recordedRecoveryPercent(detail);
  const sentences = (base.resolution ?? '').split(/(?<=\.)\s+/).filter(Boolean);
  const recommendations = sentences.filter((sentence) => /replace|inspect|recommend|maintenance/i.test(sentence));
  const outcome = sentences.filter((sentence) => !recommendations.includes(sentence)).join(' ');

  return <section className="investigation-card recovery-result" aria-label={verified ? 'Verified recovery outcome' : 'Incident outcome'}>
    <div className="investigation-card-head"><span className="investigation-eyebrow">{verified ? 'Verified outcome' : 'Incident outcome'}</span><Pill tone="ok">{verified ? 'Verifier passed' : 'Closed'}</Pill></div>
    <h3>{verified ? 'Recovery verified' : 'Incident closed'}</h3>
    {recordedPercent && <div className="recovery-hero"><strong>{recordedPercent}<span>%</span></strong><p>of baseline at verification</p></div>}
    {outcome && <div className="recovery-verdict"><span className="investigation-meta-label">Recorded result</span><p>{outcome}</p></div>}
    {recommendations.length > 0 && <div className="recovery-followup"><span className="investigation-meta-label">Further work recommended</span>{recommendations.map((sentence, index) => <p key={index}>{sentence}</p>)}</div>}
    {base.root_cause && <details className="investigation-inline-details"><summary>Recorded cause</summary><p>{base.root_cause}</p></details>}
    <details className="investigation-inline-details"><summary>Current flow and verification record</summary>
      {fresh && current ? <dl className="recovery-current"><div><dt>Current product flow</dt><dd>{current.value.toFixed(0)} <small>{signal?.unit ?? 'L/h'}</small></dd></div><div><dt>Current baseline comparison</dt><dd>{current.pct.toFixed(1)}%</dd></div></dl> : <p className="investigation-meta">A fresh live flow reading is unavailable. The recorded outcome above is preserved.</p>}
      {fresh && current && <p className="investigation-meta">Current flow is the mean of the latest five seconds of received {FLOW_TAG} samples. This live comparison is separate from the recorded verification result.</p>}
      <p className="investigation-meta">{base.closed_at ? `Closed ${formatDateTime(base.closed_at)}` : 'Closure time not recorded'}{base.closed_by ? ` · ${base.closed_by}` : ''}.</p>
    </details>
  </section>;
};

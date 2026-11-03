import React, { useMemo } from 'react';
import { formatDateTime } from '../../lib/format';
import { usePlant } from '../../state/PlantContext';
import type { IncidentDetail } from '../../types';
import { Icon } from '../common/Icon';
import { Pill } from '../common/Pill';

const FLOW_TAG = 'FIT-301';
const RECENT_MS = 5000;

function recommendations(resolution: string | null): string[] {
  if (!resolution) return [];
  return resolution
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => /replace|inspect|recommend/i.test(s));
}

export const ClosedResult: React.FC<{ detail: IncidentDetail }> = ({ detail }) => {
  const { readings, series, baselines, plant } = usePlant();
  const base = detail.incident;
  const signal = plant?.signals.find((s) => s.tag === FLOW_TAG);
  const baseline = baselines[FLOW_TAG];

  const recovered = useMemo(() => {
    const all = series[FLOW_TAG] ?? [];
    const last = all.length ? all[all.length - 1].t : 0;
    const recent = all.filter((p) => p.t >= last - RECENT_MS);
    const latest = readings[FLOW_TAG]?.value ?? null;
    const value = recent.length ? recent.reduce((sum, p) => sum + p.v, 0) / recent.length : latest;
    if (value === null || !baseline?.value) return null;
    return { value, pct: (value / baseline.value) * 100, samples: recent.length || 1 };
  }, [series, readings, baseline]);

  const advice = recommendations(base.resolution);
  const verified = base.closed_by === 'verifier';

  return (
    <section className="panel stack-card closed-card" aria-label="Incident closed">
      <div className="panel-head">
        <h3 className="panel-title">
          <Icon name="check" size={18} /> Incident closed
        </h3>
        <Pill tone="ok">{verified ? 'Verifier passed' : `Closed by ${base.closed_by ?? 'operator'}`}</Pill>
      </div>
      {base.closed_at && <p className="muted small">Closed {formatDateTime(base.closed_at)} by the deterministic verifier on telemetry, not by a model.</p>}
      {recovered && (
        <dl className="recovery">
          <div>
            <dt>{FLOW_TAG} now</dt>
            <dd className="num strong">
              {recovered.value.toFixed(0)} <span className="muted">{signal?.unit ?? 'L/h'}</span>
            </dd>
          </div>
          <div>
            <dt>Learned baseline</dt>
            <dd className="num">
              {baseline?.value.toFixed(0)} <span className="muted">{signal?.unit ?? 'L/h'}</span>
            </dd>
          </div>
          <div>
            <dt>Recovered</dt>
            <dd className="num strong">{recovered.pct.toFixed(0)}% of baseline</dd>
          </div>
        </dl>
      )}
      {recovered && <p className="muted small">Computed from the last {RECENT_MS / 1000} s of streamed {FLOW_TAG} samples ({recovered.samples}) and the learned baseline.</p>}
      {base.resolution && (
        <div className="result-block">
          <strong>Verifier result</strong>
          <p>{base.resolution}</p>
        </div>
      )}
      {base.root_cause && (
        <div className="result-block">
          <strong>Cause</strong>
          <p>{base.root_cause}</p>
        </div>
      )}
      {advice.length > 0 && (
        <div className="result-block is-advice">
          <strong>Still recommended</strong>
          <ul>
            {advice.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted small">Press Reset above to run the scenario again.</p>
    </section>
  );
};

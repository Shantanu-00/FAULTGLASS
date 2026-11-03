import React from 'react';
import { decimals } from '../../lib/signals';
import { formatTime, humanize } from '../../lib/format';
import { usePlant } from '../../state/PlantContext';
import type { Flag, IncidentDetail } from '../../types';
import { Pill, type Tone } from '../common/Pill';

const SEVERITY_TONE: Record<string, Tone> = { info: 'neutral', warning: 'warning', critical: 'alarm' };

interface Props {
  flag: Flag | NonNullable<IncidentDetail['flag']>;
}

export const FlagCard: React.FC<Props> = ({ flag }) => {
  const { plant } = usePlant();
  const evidence = 'evidence' in flag ? flag.evidence?.signals : undefined;
  const decimalsFor = (tag: string) => {
    const signal = plant?.signals.find((s) => s.tag === tag);
    return signal ? decimals(signal) : 1;
  };

  return (
    <section className="panel stack-card flag-card" aria-label="Spark watcher flag">
      <div className="panel-head">
        <h3 className="panel-title">Spark watcher flag</h3>
        <span className="head-meta">
          <Pill tone={SEVERITY_TONE[flag.severity] ?? 'neutral'}>{humanize(flag.severity)}</Pill>
          <time>{formatTime(flag.raised_at)}</time>
        </span>
      </div>
      <p className="flag-summary">{flag.summary}</p>
      <div className="chips">
        {flag.tags.map((tag) => (
          <code className="tag" key={tag}>
            {tag}
          </code>
        ))}
      </div>
      {evidence && Object.keys(evidence).length > 0 && (
        <table className="mini-table" aria-label="Evidence behind the flag">
          <thead>
            <tr>
              <th scope="col">Signal</th>
              <th scope="col" className="num">Now</th>
              <th scope="col" className="num">Baseline</th>
              <th scope="col" className="num">Change</th>
              <th scope="col" className="num">Sigma</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(evidence).map(([tag, s]) => (
              <tr key={tag}>
                <th scope="row">
                  <code className="tag">{tag}</code>
                </th>
                <td className="num strong">{Number(s.current).toFixed(decimalsFor(tag))}</td>
                <td className="num">{Number(s.baseline).toFixed(decimalsFor(tag))}</td>
                <td className="num">
                  {s.pct > 0 ? '+' : s.pct < 0 ? '−' : ''}
                  {Math.abs(s.pct).toFixed(1)}%
                </td>
                <td className="num">{Number(s.sigma).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="attribution">
        {flag.model ? `Raised by ${flag.model}` : 'Raised by the watcher'}. Baseline, spread and distance are computed in code; the model only answers NORMAL, WATCH or FLAG.
      </p>
    </section>
  );
};

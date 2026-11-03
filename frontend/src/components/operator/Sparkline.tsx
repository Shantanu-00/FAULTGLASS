import React from 'react';
import type { SeriesPoint } from '../../types';

const W = 132;
const H = 32;

interface Props {
  points: SeriesPoint[];
  nominal?: number;
  spread: number;
  tone: 'normal' | 'warning' | 'alarm' | 'stale';
}

export const Sparkline: React.FC<Props> = ({ points, nominal, spread, tone }) => {
  if (points.length < 2) {
    return <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" />;
  }
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const values = points.map((p) => p.v);
  const lo = Math.min(...values, ...(nominal === undefined ? [] : [nominal - spread]));
  const hi = Math.max(...values, ...(nominal === undefined ? [] : [nominal + spread]));
  const x = (t: number) => (t1 === t0 ? W : ((t - t0) / (t1 - t0)) * W);
  const y = (v: number) => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6);
  const trace = points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');

  return (
    <svg className={`spark spark-${tone}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Last five minutes">
      {nominal !== undefined && <line className="spark-nominal" x1="0" x2={W} y1={y(nominal)} y2={y(nominal)} />}
      <polyline className="spark-trace" points={trace} />
    </svg>
  );
};

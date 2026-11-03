import React from 'react';
import type { SeriesPoint } from '../../types';

interface Props {
  points: SeriesPoint[];
  baseline?: number;
  spread: number;
  tone: 'normal' | 'warning' | 'alarm' | 'stale';
  markAt?: number | null;
  width?: number;
  height?: number;
  label?: string;
}

export const Sparkline: React.FC<Props> = ({ points, baseline, spread, tone, markAt, width = 84, height = 30, label = 'Recent trend' }) => {
  const W = width;
  const H = height;
  if (points.length < 2) {
    return <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" />;
  }
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const values = points.map((p) => p.v);
  const lo = Math.min(...values, ...(baseline === undefined ? [] : [baseline - spread]));
  const hi = Math.max(...values, ...(baseline === undefined ? [] : [baseline + spread]));
  const x = (t: number) => (t1 === t0 ? W : ((t - t0) / (t1 - t0)) * W);
  const y = (v: number) => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6);
  const trace = points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const mark = markAt && markAt > t0 && markAt < t1 ? x(markAt) : null;

  return (
    <svg className={`spark spark-${tone}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {baseline !== undefined && <line className="spark-nominal" x1="0" x2={W} y1={y(baseline)} y2={y(baseline)} />}
      {mark !== null && <line className="spark-mark" x1={mark} x2={mark} y1="0" y2={H} />}
      <polyline className="spark-trace" points={trace} />
    </svg>
  );
};

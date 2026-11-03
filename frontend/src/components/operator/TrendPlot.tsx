import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SeriesPoint } from '../../types';

export interface TrendEvent {
  id: string;
  at: number;
  label: string;
  tone?: 'accent' | 'warning' | 'ok';
}

interface Props {
  points: SeriesPoint[];
  label: string;
  unit: string;
  domain: [number, number];
  yTickValues?: number[];
  baseline?: number;
  baselineLabel?: string;
  events?: TrendEvent[];
  height?: number;
  emptyMessage?: string;
  gapThresholdMs?: number;
  tone?: 'normal' | 'warning' | 'alarm' | 'stale';
  compact?: boolean;
}

const timeLabel = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const tickLabel = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);

function mergePoints(previous: SeriesPoint[], incoming: SeriesPoint[], startAt: number): SeriesPoint[] {
  const values = new Map<number, number>();
  for (const point of [...previous, ...incoming]) {
    if (Number.isFinite(point.t) && Number.isFinite(point.v) && point.t >= startAt) values.set(point.t, point.v);
  }
  return Array.from(values, ([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
}

// Retain samples received by this view as the provider's rolling window moves.
// A different run starts a different history.
export function useRetainedRunSeries(points: SeriesPoint[], runKey: string, startAt: number): SeriesPoint[] {
  const [history, setHistory] = useState<{ key: string; points: SeriesPoint[] }>({ key: runKey, points: [] });
  const merged = useMemo(() => mergePoints(history.key === runKey ? history.points : [], points, startAt), [history, points, runKey, startAt]);
  useEffect(() => {
    setHistory((previous) => ({ key: runKey, points: mergePoints(previous.key === runKey ? previous.points : [], points, startAt) }));
  }, [points, runKey, startAt]);
  return merged;
}

export const TrendPlot: React.FC<Props> = ({ points, label, unit, domain, yTickValues, baseline, baselineLabel = 'Baseline', events = [], height = 210, emptyMessage = 'Waiting for measurement history.', gapThresholdMs = 15_000, tone = 'normal', compact = false }) => {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const id = useId();
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const update = (nextWidth: number) => { if (nextWidth > 0) setWidth(Math.round(nextWidth)); };
    update(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const data = useMemo(() => mergePoints([], points, -Infinity), [points]);
  const first = data[0];
  const last = data[data.length - 1];
  const left = compact ? 50 : 62;
  const right = 16;
  const top = compact ? 22 : 27;
  const bottom = height - (compact ? 34 : 49);
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = bottom - top;
  const yMin = domain[0];
  const yMax = domain[1] > yMin ? domain[1] : yMin + 1;
  const firstAt = first?.t ?? 0;
  const lastAt = last?.t ?? 1;
  const visibleEvents = events.filter((event) => Number.isFinite(event.at) && first && event.at >= firstAt).sort((a, b) => a.at - b.at);
  const latestEvent = visibleEvents[visibleEvents.length - 1]?.at ?? lastAt;
  const endAt = Math.max(lastAt, latestEvent);
  const tMin = firstAt === endAt ? firstAt - 1000 : firstAt;
  const tMax = firstAt === endAt ? endAt + 1000 : endAt;
  const x = (at: number) => left + ((at - tMin) / (tMax - tMin)) * plotWidth;
  const y = (value: number) => bottom - ((value - yMin) / (yMax - yMin)) * plotHeight;
  const yTicks = yTickValues?.filter((value) => value >= yMin && value <= yMax) ?? Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) * index) / 4);
  const xTickCount = width < 440 ? 2 : width < 700 ? 4 : 5;
  const xTicks = Array.from({ length: xTickCount }, (_, index) => tMin + ((tMax - tMin) * index) / (xTickCount - 1));
  const intervals = data.slice(1).map((point, index) => point.t - data[index].t).sort((a, b) => a - b);
  const cadence = intervals[Math.floor(intervals.length / 2)];
  const gapAfter = intervals.length >= 4 ? Math.min(gapThresholdMs, Math.max(cadence * 1.8, 1000)) : gapThresholdMs;
  const startsSegment = (index: number) => index === 0 || data[index].t - data[index - 1].t > gapAfter;
  const path = data.map((point, index) => `${startsSegment(index) ? 'M' : 'L'}${x(point.t).toFixed(2)},${y(point.v).toFixed(2)}`).join(' ');
  const gaps = data.filter((_, index) => index > 0 && startsSegment(index)).length;
  const isolated = data.filter((_, index) => startsSegment(index) && (index === data.length - 1 || startsSegment(index + 1)));
  const min = data.length ? data.reduce((value, point) => Math.min(value, point.v), Infinity) : null;
  const max = data.length ? data.reduce((value, point) => Math.max(value, point.v), -Infinity) : null;

  return (
    <figure className={`trend-plot tone-${tone}`} aria-label={label}>
      <div className="trend-legend"><span><i className="trend-key-line" aria-hidden="true" />Measured</span>{baseline !== undefined && <span><i className="trend-key-baseline" aria-hidden="true" />{baselineLabel}</span>}{gaps > 0 && <span>{gaps} gap{gaps === 1 ? '' : 's'} in received samples</span>}</div>
      <div className="trend-canvas" ref={container}>
        {data.length ? (
          <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
            <title id={`${id}-title`}>{label}</title>
            <desc id={`${id}-description`}>{data.length} samples from {timeLabel(firstAt)} to {timeLabel(lastAt)}. Latest {tickLabel(last.v)} {unit}; minimum {tickLabel(min!)}; maximum {tickLabel(max!)}. {baseline !== undefined ? `${baselineLabel}: ${tickLabel(baseline)} ${unit}.` : ''} {gaps ? `${gaps} gaps are left unconnected.` : ''}</desc>
            <defs><clipPath id={`${id}-clip`}><rect x={left} y={top} width={plotWidth} height={plotHeight} /></clipPath></defs>
            <text className="trend-axis-title" x={left} y={13}>{unit}</text>
            {yTicks.map((value) => <g key={value}><line className="trend-grid-line" x1={left} x2={width - right} y1={y(value)} y2={y(value)} /><text className="trend-tick" x={left - 9} y={y(value) + 4} textAnchor="end">{tickLabel(value)}</text></g>)}
            {xTicks.map((at, index) => <g key={index}><line className="trend-axis-tick" x1={x(at)} x2={x(at)} y1={bottom} y2={bottom + 4} /><text className="trend-tick" x={x(at)} y={bottom + 20} textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}>{timeLabel(at)}</text></g>)}
            <text className="trend-axis-title" x={width - right} y={height - 2} textAnchor="end">Time</text>
            <g clipPath={`url(#${id}-clip)`}>
              {baseline !== undefined && <line className="trend-baseline" x1={left} x2={width - right} y1={y(baseline)} y2={y(baseline)} />}
              {visibleEvents.map((event) => <line key={event.id} className={`trend-event-line event-${event.tone ?? 'accent'}`} x1={x(event.at)} x2={x(event.at)} y1={top} y2={bottom} />)}
              <path className="trend-measurement" d={path} />{isolated.map((point) => <circle key={point.t} className="trend-isolated-point" cx={x(point.t)} cy={y(point.v)} r={2.5} />)}<circle className="trend-last-point" cx={x(last.t)} cy={y(last.v)} r={3.5} />
            </g>
            {visibleEvents.map((event, index) => <g key={event.id} className={`trend-event-marker event-${event.tone ?? 'accent'}`}><title>{`${event.label} at ${timeLabel(event.at)}`}</title><circle cx={x(event.at)} cy={top + 10 + (index % 2) * 24} r={10} /><text x={x(event.at)} y={top + 14 + (index % 2) * 24} textAnchor="middle">{index + 1}</text></g>)}
          </svg>
        ) : <div className="trend-empty" style={{ minHeight: height }} role="status">{emptyMessage}</div>}
      </div>
      {visibleEvents.length > 0 && <figcaption className="trend-events">{visibleEvents.map((event, index) => <span key={event.id}><b className={`event-${event.tone ?? 'accent'}`}>{index + 1}</b>{event.label}<time dateTime={new Date(event.at).toISOString()}>{timeLabel(event.at)}</time></span>)}</figcaption>}
    </figure>
  );
};

import type { SeriesPoint } from '../types';

/** Fit observed values and the operating reference, keeping readable tick steps. */
export function productionChartScale(points: SeriesPoint[], baseline?: number, current?: number | null) {
  const values = points.map(point => point.v).filter(Number.isFinite);
  if (baseline !== undefined && Number.isFinite(baseline)) values.push(baseline);
  if (current !== null && current !== undefined && Number.isFinite(current)) values.push(current);
  if (!values.length) return { domain: [0, 100] as [number, number], ticks: [0, 25, 50, 75, 100] };
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max((high - low) * .16, baseline === 100 ? 3 : Math.abs(high) * .04, .1);
  const ideal = (high - low + padding * 2) / 4;
  const power = 10 ** Math.floor(Math.log10(ideal));
  const step = ([1, 2, 5, 10].find(value => value * power >= ideal) ?? 10) * power;
  const min = low >= 0 ? Math.max(0, Math.floor((low - padding) / step) * step) : Math.floor((low - padding) / step) * step;
  const max = Math.ceil((high + padding) / step) * step;
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => Number((min + index * step).toPrecision(12)));
  return { domain: [min, max] as [number, number], ticks };
}

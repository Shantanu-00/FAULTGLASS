const W = 132;
const H = 30;
const NS = 'http://www.w3.org/2000/svg';

export function sparkline(points, { nominal, spread }) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'spark');
  if (points.length < 2) return svg;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const values = points.map((p) => p.v);
  const lo = Math.min(...values, nominal - spread);
  const hi = Math.max(...values, nominal + spread);
  const x = (t) => (t1 === t0 ? W : ((t - t0) / (t1 - t0)) * W);
  const y = (v) => H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4);
  if (nominal !== undefined) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', 0);
    line.setAttribute('x2', W);
    line.setAttribute('y1', y(nominal));
    line.setAttribute('y2', y(nominal));
    line.setAttribute('class', 'nominal');
    svg.append(line);
  }
  const path = document.createElementNS(NS, 'polyline');
  path.setAttribute('points', points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '));
  path.setAttribute('class', 'trace');
  svg.append(path);
  return svg;
}

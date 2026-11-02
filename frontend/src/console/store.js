const WINDOW_MS = 5 * 60 * 1000;

export class Store {
  constructor() {
    this.signals = [];
    this.readings = new Map();
    this.series = new Map();
    this.run = null;
    this.flags = [];
    this.simulation = false;
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  setSignals(signals) {
    this.signals = signals;
    for (const s of signals) this.series.set(s.tag, []);
  }

  setHistory(tag, points) {
    this.series.set(
      tag,
      points.filter((p) => p.value !== null).map((p) => ({ t: Date.parse(p.observed_at), v: p.value })),
    );
  }

  applyRows(rows) {
    for (const row of rows) {
      const previous = this.readings.get(row.tag);
      if (previous && previous.observed_at > row.observed_at) continue;
      this.readings.set(row.tag, {
        value: row.value,
        quality: row.quality,
        observed_at: row.observed_at,
        run_id: row.run_id ?? null,
      });
      const line = this.series.get(row.tag);
      if (line && row.value !== null) {
        const t = Date.parse(row.observed_at);
        if (!line.length || line[line.length - 1].t < t) line.push({ t, v: row.value });
        const cutoff = t - WINDOW_MS;
        while (line.length && line[0].t < cutoff) line.shift();
      }
    }
    this.emit();
  }

  setRun(run) {
    this.run = run;
    this.emit();
  }

  setFlags(flags) {
    this.flags = flags;
    this.emit();
  }

  get simulated() {
    for (const r of this.readings.values()) if (r.run_id) return true;
    return false;
  }
}

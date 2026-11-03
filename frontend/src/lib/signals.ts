import type { Reading, Signal } from '../types';

export type SignalState = 'ok' | 'warning' | 'alarm' | 'stale';

const ABNORMAL_LABEL = /TRIP|FAULT|^LOW_|^HIGH_/;

export function isAbnormalLabel(label: string | undefined): boolean {
  return label !== undefined && ABNORMAL_LABEL.test(label);
}

export function labelFor(signal: Signal, value: number): string | undefined {
  return signal.state_labels?.[String(Math.round(value))];
}

export function signalState(signal: Signal, reading: Reading | undefined, now: number): SignalState {
  if (!reading || reading.value === null || reading.quality === 'bad' || reading.quality === 'stale') return 'stale';
  const ageS = (now - Date.parse(reading.observed_at)) / 1000;
  if (ageS > Math.max((signal.freshness_s ?? 5) * 3, 10)) return 'stale';
  if (signal.type !== 'measurement') {
    return isAbnormalLabel(labelFor(signal, reading.value)) ? 'alarm' : 'ok';
  }
  const l = signal.limits;
  const v = reading.value;
  if ((l.low_trip !== undefined && v <= l.low_trip) || (l.high_trip !== undefined && v >= l.high_trip)) return 'alarm';
  if ((l.low_alarm !== undefined && v <= l.low_alarm) || (l.high_alarm !== undefined && v >= l.high_alarm)) return 'warning';
  return 'ok';
}

export function decimals(signal: Signal): number {
  return signal.unit === 'L/h' ? 0 : 1;
}

export interface SignalGroup {
  title: string;
  signals: Signal[];
}

const GROUPS: Array<{ title: string; quantities: string[] }> = [
  { title: 'Product water', quantities: ['flow', 'tds'] },
  { title: 'High-pressure pump', quantities: ['pressure', 'pressure_switch', 'current'] },
  { title: 'Pumps', quantities: ['run_state'] },
  { title: 'Tanks', quantities: ['level_switch'] },
  { title: 'RO machine', quantities: ['cycle_state', 'fault_code'] },
];

export function groupSignals(signals: Signal[]): SignalGroup[] {
  const used = new Set<string>();
  const groups: SignalGroup[] = [];
  for (const group of GROUPS) {
    const members = signals
      .filter((s) => group.quantities.includes(s.quantity))
      .sort((a, b) => Number(b.type === 'measurement') - Number(a.type === 'measurement'));
    members.forEach((s) => used.add(s.tag));
    if (members.length) groups.push({ title: group.title, signals: members });
  }
  const rest = signals.filter((s) => !used.has(s.tag));
  if (rest.length) groups.push({ title: 'Other signals', signals: rest });
  return groups;
}

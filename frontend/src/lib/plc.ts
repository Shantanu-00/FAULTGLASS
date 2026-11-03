import type { Reading, Signal } from '../types';
import { isAbnormalLabel, signalState } from './signals';

export interface PlcStatus {
  watched: number;
  active: Array<{ tag: string; state: 'warning' | 'alarm' }>;
  unknown: number;
}

function canAlarm(signal: Signal): boolean {
  if (signal.type === 'measurement') {
    const l = signal.limits;
    return l.low_alarm !== undefined || l.high_alarm !== undefined || l.low_trip !== undefined || l.high_trip !== undefined;
  }
  return Object.values(signal.state_labels ?? {}).some((label) => isAbnormalLabel(label));
}

// What the PLC itself would show: pressure and level switches, the RO fault code, and the
// configured alarm or trip limits. Streamed drift is judged elsewhere.
export function plcStatus(signals: Signal[], readings: Record<string, Reading>, now: number): PlcStatus {
  const watched = signals.filter(canAlarm);
  const active: PlcStatus['active'] = [];
  let unknown = 0;
  for (const signal of watched) {
    const state = signalState(signal, readings[signal.tag], now);
    if (state === 'alarm' || state === 'warning') active.push({ tag: signal.tag, state });
    else if (state === 'stale') unknown += 1;
  }
  return { watched: watched.length, active, unknown };
}

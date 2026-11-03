import type { Differential, FieldTaskResult, GaugeResult } from '../types';

export function resultReadings(result: FieldTaskResult): [string, number][] {
  return Object.entries({ ...result.accepted, ...result.readings }).filter((entry): entry is [string, number] => Number.isFinite(entry[1]));
}

export function resultGauges(result: FieldTaskResult): GaugeResult[] {
  const gauges = result.gauges?.length ? result.gauges : Object.values(result.gauges_by_tag ?? {});
  return gauges.filter(gauge => gauge && typeof gauge.tag === 'string');
}

export function validatedDifferential(result: FieldTaskResult): Differential | null {
  const d = result.differential;
  return d && typeof d.inlet_tag === 'string' && typeof d.outlet_tag === 'string'
    && [d.inlet_psi, d.outlet_psi, d.dp_psi, d.normal_dp_psi, d.limit_dp_psi].every(Number.isFinite)
    && typeof d.restricted === 'boolean' ? d : null;
}

export function resultSource(result: FieldTaskResult): string | null {
  return result.source === 'manual_entry' ? 'Manually entered by the worker'
    : result.source === 'gauge_photo' ? 'Read from submitted gauge photos'
    : result.source === 'valve_video' ? 'Checked from the submitted valve recording'
    : result.source ? result.source.replace(/_/g, ' ') : null;
}

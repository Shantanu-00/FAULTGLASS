export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '-'
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Backend identifiers arrive as UPPER_SNAKE (RUNNING, LOW_PRESSURE_TRIP) or snake_case.
export function humanize(value: string): string {
  const text = value.replace(/_/g, ' ').trim().toLowerCase().replace(/\bok\b/g, 'OK');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

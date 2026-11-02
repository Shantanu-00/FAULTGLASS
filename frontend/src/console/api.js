const BASE = (import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

async function request(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
    } catch {}
    throw Object.assign(new Error(detail), { status: response.status });
  }
  return response.status === 204 ? null : response.json();
}

export const api = {
  plant: () => request('GET', '/v1/plant'),
  latest: () => request('GET', '/v1/telemetry/latest'),
  history: (tag, seconds = 300) => request('GET', `/v1/telemetry/history?tag=${encodeURIComponent(tag)}&seconds=${seconds}&limit=600`),
  currentRun: () => request('GET', '/v1/sim/runs/current'),
  startRun: (clockSpeed) => request('POST', '/v1/sim/runs', { clock_speed: clockSpeed }),
  stopRun: (id) => request('POST', `/v1/sim/runs/${id}/stop`),
  heartbeat: (id) => request('POST', `/v1/sim/runs/${id}/heartbeat`),
  sendEvent: (id, kind, payload) => request('POST', `/v1/sim/runs/${id}/events`, { kind, payload }),
  flags: () => request('GET', '/v1/flags'),
  incidents: () => request('GET', '/v1/incidents'),
  incident: (id) => request('GET', `/v1/incidents/${encodeURIComponent(id)}`),
  completeTask: (incidentId, taskId, readings, note) =>
    request('POST', `/v1/incidents/${encodeURIComponent(incidentId)}/tasks/${taskId}/complete`, { readings, note }),
  streamUrl: () => `${BASE}/v1/telemetry/stream`,
};

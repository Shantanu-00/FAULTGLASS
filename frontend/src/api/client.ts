import type { Flag, InvestigationDetail, Reading, RunDiagnostics, Signal } from '../types';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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

  return response.status === 204 ? (null as T) : response.json();
}

export const api = {
  healthz: () => request<{ status: string }>('GET', '/v1/healthz'),
  plant: () => request<{ id: string; name: string; signals: Signal[] }>('GET', '/v1/plant'),
  latest: () => request<{ readings: Record<string, Reading> }>('GET', '/v1/telemetry/latest'),
  history: (tag: string, seconds = 300) =>
    request<{ series: Reading[] }>('GET', `/v1/telemetry/history?tag=${encodeURIComponent(tag)}&seconds=${seconds}&limit=600`),
  currentRun: () => request<{ run: RunDiagnostics | null }>('GET', '/v1/sim/runs/current'),
  startRun: (clockSpeed = 1) => request<{ run: RunDiagnostics }>('POST', '/v1/sim/runs', { clock_speed: clockSpeed }),
  stopRun: (id: string) => request<void>('POST', `/v1/sim/runs/${id}/stop`),
  heartbeat: (id: string) => request<void>('POST', `/v1/sim/runs/${id}/heartbeat`),
  sendEvent: (id: string, kind: string, payload: unknown) =>
    request<{ accepted: boolean }>('POST', `/v1/sim/runs/${id}/events`, { kind, payload }),
  flags: () => request<{ flags: Flag[] }>('GET', '/v1/flags'),
  incidents: () => request<{ incidents: Array<{ incident_id: string; title: string; status: string }> }>('GET', '/v1/incidents'),
  incident: (id: string) => request<InvestigationDetail>('GET', `/v1/incidents/${encodeURIComponent(id)}`),
  completeTask: (incidentId: string, taskId: string, readings: Record<string, number>, note: string) =>
    request<{ completed: boolean; reason?: string }>('POST', `/v1/incidents/${encodeURIComponent(incidentId)}/tasks/${taskId}/complete`, { readings, note }),
  completeTaskPhoto: (incidentId: string, taskId: string, imageBase64: string, note: string, audioBase64: string | null = null) =>
    request<{ completed: boolean; readings: Array<{ tag: string; value: number | null; status: string }>; readings_stored: number; reason?: string; voice?: { transcript?: string; comparison?: { status: string } } }>(
      'POST',
      `/v1/incidents/${encodeURIComponent(incidentId)}/tasks/${taskId}/photo`,
      { image_base64: imageBase64, audio_base64: audioBase64, note },
    ),
  submitTaskVoice: (incidentId: string, taskId: string, audioBase64: string, languageBias = ['English']) =>
    request<{ voice: { transcript: string; comparison: { status: string } } }>(
      'POST',
      `/v1/incidents/${encodeURIComponent(incidentId)}/tasks/${taskId}/voice`,
      { audio_base64: audioBase64, language_bias: languageBias },
    ),
  completeTaskVideo: (incidentId: string, taskId: string, videoBase64: string, mimeType: string, fps: number | null, durationS: number | null, note: string) =>
    request<{ completed: boolean; policy: { status: string; stages_seen: string[]; reasons: string[] }; reason?: string }>(
      'POST',
      `/v1/incidents/${encodeURIComponent(incidentId)}/tasks/${taskId}/video`,
      { video_base64: videoBase64, mime_type: mimeType, fps, duration_s: durationS, note },
    ),
  approveProposal: (incidentId: string, proposalId: string) =>
    request<void>('POST', `/v1/incidents/${encodeURIComponent(incidentId)}/proposals/${proposalId}/approve`),
  rejectProposal: (incidentId: string, proposalId: string) =>
    request<void>('POST', `/v1/incidents/${encodeURIComponent(incidentId)}/proposals/${proposalId}/reject`),
  streamUrl: () => `${BASE}/v1/telemetry/stream`,
};

import type {
  Flag,
  HistoryPoint,
  IncidentDetail,
  IncidentSummary,
  PhotoResponse,
  PlantInfo,
  RunDiagnostics,
  TelemetryRow,
  VideoResponse,
  VoicePayload,
} from '../types';

export const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Network error', 0);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail || `HTTP ${response.status}`, response.status);
  }

  return response.status === 204 ? (null as T) : response.json();
}

const enc = encodeURIComponent;

export const api = {
  healthz: () => request<{ status: string }>('GET', '/v1/healthz'),
  plant: () => request<PlantInfo>('GET', '/v1/plant'),
  latest: () => request<{ readings: TelemetryRow[]; run: RunDiagnostics | null }>('GET', '/v1/telemetry/latest'),
  history: (tag: string, seconds = 300, limit = 600) =>
    request<{ tag: string; points: HistoryPoint[] }>('GET', `/v1/telemetry/history?tag=${enc(tag)}&seconds=${seconds}&limit=${limit}`),
  currentRun: () => request<{ run: RunDiagnostics | null }>('GET', '/v1/sim/runs/current'),
  startRun: (clockSpeed: number) => request<RunDiagnostics>('POST', '/v1/sim/runs', { clock_speed: clockSpeed }),
  resetRun: (clockSpeed: number) => request<RunDiagnostics>('POST', '/v1/sim/reset', { clock_speed: clockSpeed }),
  stopRun: (id: string) => request<void>('POST', `/v1/sim/runs/${id}/stop`),
  heartbeat: (id: string) => request<void>('POST', `/v1/sim/runs/${id}/heartbeat`),
  sendEvent: (id: string, kind: 'scenario' | 'valve_action', payload: Record<string, unknown>) =>
    request<{ id: number; kind: string; at: string }>('POST', `/v1/sim/runs/${id}/events`, { kind, payload }),
  flags: () => request<{ flags: Flag[] }>('GET', '/v1/flags'),
  incidents: () => request<{ incidents: IncidentSummary[] }>('GET', '/v1/incidents'),
  incident: (id: string) => request<IncidentDetail>('GET', `/v1/incidents/${enc(id)}`),
  completeTask: (incidentId: string, taskId: string, readings: Record<string, number>, note: string) =>
    request<{ completed: boolean; readings_stored: number }>(
      'POST',
      `/v1/incidents/${enc(incidentId)}/tasks/${taskId}/complete`,
      { readings, note },
    ),
  completeTaskPhoto: (incidentId: string, taskId: string, photos: Record<string, string>, note: string, audioBase64: string | null) =>
    request<PhotoResponse>('POST', `/v1/incidents/${enc(incidentId)}/tasks/${taskId}/photo`, {
      photos,
      audio_base64: audioBase64,
      note,
    }),
  submitTaskVoice: (incidentId: string, taskId: string, audioBase64: string, languageBias = ['Marathi', 'English']) =>
    request<{ recorded: boolean; voice: VoicePayload }>('POST', `/v1/incidents/${enc(incidentId)}/tasks/${taskId}/voice`, {
      audio_base64: audioBase64,
      language_bias: languageBias,
    }),
  completeTaskVideo: (
    incidentId: string,
    taskId: string,
    videoBase64: string,
    mimeType: string,
    fps: number | null,
    durationS: number | null,
    note: string,
  ) =>
    request<VideoResponse>('POST', `/v1/incidents/${enc(incidentId)}/tasks/${taskId}/video`, {
      video_base64: videoBase64,
      mime_type: mimeType,
      fps,
      duration_s: durationS,
      note,
    }),
  approveProposal: (incidentId: string, proposalId: string) =>
    request<{ approved: boolean; field_task_id: string }>('POST', `/v1/incidents/${enc(incidentId)}/proposals/${proposalId}/approve`),
  rejectProposal: (incidentId: string, proposalId: string) =>
    request<{ rejected: boolean }>('POST', `/v1/incidents/${enc(incidentId)}/proposals/${proposalId}/reject`),
  streamUrl: () => `${API_BASE}/v1/telemetry/stream`,
};

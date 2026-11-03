export type SignalType = 'measurement' | 'switch' | 'status';

export interface SignalLimits {
  nominal?: number;
  low_alarm?: number;
  high_alarm?: number;
  low_trip?: number;
  high_trip?: number;
}

export interface Signal {
  tag: string;
  name: string;
  type: SignalType;
  quantity: string;
  unit: string;
  range: [number, number];
  limits: SignalLimits;
  state_labels: Record<string, string> | null;
  freshness_s: number | null;
}

export interface PlantInfo {
  plant_id: string;
  name: string;
  simulation: boolean;
  signals: Signal[];
}

export interface TelemetryRow {
  tag: string;
  value: number | null;
  unit: string | null;
  quality: 'good' | 'bad' | 'stale' | 'uncertain';
  observed_at: string;
  run_id: string | null;
}

export interface HistoryPoint {
  observed_at: string;
  value: number | null;
  quality: string;
}

export interface Reading {
  value: number | null;
  quality: string;
  observed_at: string;
  run_id: string | null;
}

export interface SeriesPoint {
  t: number;
  v: number;
}

export interface RunDiagnostics {
  id: string;
  status: 'starting' | 'learning' | 'running' | 'stopped';
  clock_speed: number;
  scenario: string | null;
  scenario_started_at: string | null;
  started_at: string;
  baseline_ready_at: string | null;
}

export interface Flag {
  id: string;
  run_id: string | null;
  raised_at: string;
  status: 'open' | 'picked_up' | 'dismissed' | 'resolved';
  severity: 'info' | 'warning' | 'critical';
  tags: string[];
  summary: string;
  model: string | null;
  incident_id: string | null;
}

export interface FlagEvidence {
  verdict?: string;
  signals?: Record<string, { current: number; baseline: number; pct: number; sigma: number; unit: string }>;
}

export interface IncidentSummary {
  incident_id: string;
  title: string;
  status: 'open' | 'resolved' | 'closed';
  severity: 'low' | 'medium' | 'high';
  opened_at: string;
  models_used: string[];
  investigation_status: string | null;
  focus: Focus | null;
  steps_used: number | null;
  hypotheses: number;
  pending_tasks: number;
}

export interface Focus {
  goal?: string;
  blocker?: string;
  next_step?: string;
  focus_assets?: string[];
}

export interface Hypothesis {
  label: string;
  statement: string;
  status: 'open' | 'rejected' | 'supported' | 'confirmed';
  evidence_for: unknown[];
  evidence_against: unknown[];
  updated_at: string;
}

export interface GaugeResult {
  tag: string;
  box: number[] | null;
  sam_confidence: number | null;
  mask_applied: boolean;
  wonder_reasoning: string | null;
  status: string;
  value: number | null;
}

export interface VoiceComparison {
  status: string;
  summary?: string;
  wonder_summary?: string;
  spoken_readings?: Record<string, number>;
  photo_readings?: Record<string, number>;
  differences?: Record<string, number>;
}

export interface VoicePayload {
  id?: string;
  transcript?: string;
  model?: string;
  comparison?: VoiceComparison;
  structured?: { readings?: Record<string, number>; observation?: string; concerns?: string[] };
  error?: string;
}

export interface ValveSegment {
  kind: 'still' | 'moving' | string;
  start_s: number;
  end_s: number;
  duration_s: number;
}

export interface ValvePolicy {
  status: string;
  reasons: string[];
  movements: number;
  hold_s: number | null;
  segments: ValveSegment[];
  required?: string;
  min_hold_s?: number;
}

export interface FieldTaskResult {
  readings?: Record<string, number>;
  note?: string;
  source?: string;
  gauges?: GaugeResult[];
  accepted?: Record<string, number>;
  differential?: Differential | null;
  voice?: VoicePayload | null;
  policy?: ValvePolicy;
  simulator_action?: string;
}

export interface FieldTask {
  id: string;
  kind: 'gauge_photo' | 'valve_action' | 'observation';
  status: 'pending' | 'completed' | 'cancelled';
  instruction: string;
  asset_ids: string[];
  tags: string[];
  result: FieldTaskResult | null;
  created_at: string;
  completed_at: string | null;
}

export interface ActionProposal {
  id: string;
  asset_id: string;
  action: string;
  rationale: string;
  sop_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  field_task_id: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
}

export interface VoiceObservation {
  id: string;
  task_id: string | null;
  transcript: string;
  structured: VoicePayload['structured'] | null;
  comparison: VoiceComparison | null;
  model?: string;
  created_at: string;
}

export interface TraceEvent {
  seq: number;
  at: string;
  kind: string;
  actor: 'system' | 'model' | 'operator' | 'verifier' | 'code';
  hypothesis_id: string | null;
  tool_name: string | null;
  content: string;
  evidence: unknown[];
}

export interface IncidentDetail {
  incident: {
    incident_id: string;
    title: string;
    status: 'open' | 'resolved' | 'closed';
    severity: string;
    opened_at: string;
    closed_at: string | null;
    closed_by: string | null;
    root_cause: string | null;
    resolution: string | null;
    models_used: string[];
  };
  flag: (Omit<Flag, 'status' | 'incident_id'> & { evidence: FlagEvidence }) | null;
  hypotheses: Hypothesis[];
  field_tasks: FieldTask[];
  action_proposals: ActionProposal[];
  voice_observations: VoiceObservation[];
  trace: TraceEvent[];
  investigation: {
    status: string;
    steps_used: number;
    focus: Focus;
    model?: string | null;
  };
}

export interface Differential {
  inlet_tag: string;
  outlet_tag: string;
  inlet_psi: number;
  outlet_psi: number;
  dp_psi: number;
  normal_dp_psi: number;
  limit_dp_psi: number;
  restricted: boolean;
}

export interface PhotoResponse {
  completed: boolean;
  readings: GaugeResult[];
  accepted?: Record<string, number>;
  missing?: string[];
  differential?: Differential | null;
  readings_stored?: number;
  reason?: string;
  voice?: VoicePayload | null;
}

export interface VideoResponse {
  completed: boolean;
  policy: ValvePolicy;
  reason?: string;
}

export type SignalQuantity =
  | 'flow'
  | 'pressure'
  | 'pressure_switch'
  | 'current'
  | 'tds'
  | 'run_state'
  | 'level_switch'
  | 'cycle_state'
  | 'fault_code';

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
  type: 'measurement' | 'state' | 'discrete';
  quantity: SignalQuantity;
  unit: string;
  range: [number, number];
  limits: SignalLimits;
  freshness_s?: number;
  state_labels?: Record<string, string>;
}

export interface Reading {
  observed_at: string;
  value: number | null;
  quality: 'good' | 'bad' | 'stale';
}

export interface Flag {
  id: string;
  raised_at: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'active' | 'cleared' | 'acknowledged';
  summary: string;
  tags: string[];
  model?: string;
  incident_id?: string;
}

export interface Hypothesis {
  id: string;
  label: string;
  statement: string;
  status: 'suspected' | 'supported' | 'rejected' | 'confirmed';
  probability: number;
  evidence_for?: string[];
  evidence_against?: string[];
}

export interface FieldTaskResult {
  readings?: Array<{ tag: string; value: number | null; status: string }>;
  voice?: {
    transcript?: string;
    comparison?: { status: string };
  };
  policy?: {
    status: string;
    stages_seen: string[];
    reasons: string[];
  };
}

export interface FieldTask {
  id: string;
  kind: 'gauge_photo' | 'valve_action' | 'observation';
  status: 'pending' | 'completed' | 'cancelled';
  instruction: string;
  asset_ids?: string[];
  tags?: string[];
  result?: FieldTaskResult;
}

export interface ActionProposal {
  id: string;
  action: string;
  asset_id: string;
  rationale: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface VoiceObservation {
  id: string;
  transcript: string;
  structured?: Record<string, unknown>;
  comparison?: { status: string };
}

export interface TraceEvent {
  id: string;
  time: string;
  actor: 'PLANT' | 'ADK' | 'OPERATOR' | 'WONDER' | 'VERIFIER';
  kind: string;
  content: string;
  evidence?: string[];
}

export interface InvestigationDetail {
  incident: {
    incident_id: string;
    title: string;
    opened_at: string;
    status: 'open' | 'verifying' | 'resolved';
  };
  investigation: {
    status: 'open' | 'waiting_field' | 'verifying' | 'resolved';
    steps_used: number;
    focus?: {
      goal?: string;
      blocker?: string;
      next_step?: string;
      focus_assets?: string[];
    };
  };
  hypotheses: Hypothesis[];
  field_tasks: FieldTask[];
  action_proposals?: ActionProposal[];
  voice_observations?: VoiceObservation[];
  trace: TraceEvent[];
}

export interface RunDiagnostics {
  id: string;
  status: 'starting' | 'learning' | 'running' | 'stopped';
  started_at?: string;
  baseline_ready_at?: string;
  scenario?: string | null;
  scenario_started_at?: string;
  clock_speed: number;
}

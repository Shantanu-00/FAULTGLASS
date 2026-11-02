import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { Flag, InvestigationDetail, Reading, RunDiagnostics, Signal } from '../types';
import { api } from '../api/client';

export interface DemoScenario {
  id: 'filter' | 'scaling' | 'feed';
  title: string;
  targetFlow: number;
  pressReading: string;
  tdsReading: string;
  memories: string[];
  focus: string;
  hyps: Array<{ label: string; prob: number; status: 'suspected' | 'supported' | 'rejected' }>;
  gaugeTitle: string;
  gauges: Array<{ val: number; max: number; unit: string; label: string }>;
  readingSummary: string;
  diagnosis: string;
  actionTitle: string;
  actionWhy: string;
}

export const SCENARIOS: Record<'filter' | 'scaling' | 'feed', DemoScenario> = {
  filter: {
    id: 'filter',
    title: 'CARTRIDGE FILTER CLOG (CF-201A)',
    targetFlow: 3.1,
    pressReading: '9.8 bar ↓',
    tdsReading: '24 ppm',
    memories: [
      'Incident #12: ΔP 1.4 bar → cartridge clog confirmed',
      'SOP-07: ΔP > 1.2 bar = isolate & switch filter bank',
      'Site assertion: “PG-2 outlet drops first when CF-201A chokes”',
    ],
    focus: 'Cartridge Filter CF-201 A/B — the only analogue-only chokepoint between healthy feed and falling RO output.',
    hyps: [
      { label: 'Cartridge filter clogged', prob: 72, status: 'supported' },
      { label: 'RO membrane scaling', prob: 18, status: 'suspected' },
      { label: 'Low raw feed supply', prob: 10, status: 'rejected' },
    ],
    gaugeTitle: 'Cartridge Filter CF-201 Dial Gauges',
    gauges: [
      { val: 3.4, max: 4, unit: 'bar', label: 'PG-1 INLET' },
      { val: 1.8, max: 4, unit: 'bar', label: 'PG-2 OUTLET' },
    ],
    readingSummary: 'PG-1 3.4 bar − PG-2 1.8 bar = ΔP 1.6 bar (> SOP limit 1.2 bar)',
    diagnosis: 'Cartridge filter CF-201A is clogged. Feed suction and raw pumps are nominal; pressure drops severely across the 5µ filter housing. RO membranes are starved, not scaled.',
    actionTitle: 'Turn standby valve V-7 to HALF open only (50%)',
    actionWhy: 'Half-open only: sudden 100% opening causes water hammer and destroys downstream thin-film polyamide membranes. Equalise safely before full flow.',
  },
  scaling: {
    id: 'scaling',
    title: 'RO MEMBRANE SCALING (RO-302)',
    targetFlow: 4.8,
    pressReading: '16.5 bar ↑',
    tdsReading: '45 ppm ↑',
    memories: [
      'Incident #09: rising HP pressure + falling recovery → scaling',
      'SOP-11: HP > 15.5 bar with normal filter ΔP = inspect RO skid',
      'History: last CIP chemical wash was 94 days ago (due: 90)',
    ],
    focus: 'RO Membranes RO-302 — filter ΔP must be ruled out first before cleaning membranes.',
    hyps: [
      { label: 'RO membrane scaling', prob: 64, status: 'supported' },
      { label: 'Cartridge filter clogged', prob: 12, status: 'rejected' },
      { label: 'Low feed supply', prob: 8, status: 'rejected' },
    ],
    gaugeTitle: 'RO Skid RO-302 Dial Gauges',
    gauges: [
      { val: 3.1, max: 4, unit: 'bar', label: 'FILTER OUTLET (OK)' },
      { val: 16.5, max: 20, unit: 'bar', label: 'RO FEED PRESS' },
    ],
    readingSummary: 'Filter ΔP normal (0.3 bar) · RO feed 16.5 bar ↑ · TDS 45 ppm ↑',
    diagnosis: 'RO membrane scaling confirmed. The cartridge filter is healthy; head loss and salt passage occur directly across the membrane elements.',
    actionTitle: 'Turn CIP flush valve V-9 to HALF open only (50%)',
    actionWhy: 'Half opening conducts a controlled low-pressure chemical flush without membrane pressure shock.',
  },
  feed: {
    id: 'feed',
    title: 'RAW FEED STARVATION (TK-101)',
    targetFlow: 4.2,
    pressReading: '8.1 bar ↓',
    tdsReading: '19 ppm',
    memories: [
      'Incident #07: afternoon output dip traced to raw tank level drop',
      'SOP-03: Raw tank < 25% = feed starvation, check supply line first',
      'Site note: borewell replenishment slows in hot afternoon hours',
    ],
    focus: 'Raw Tank TK-101 + Feed Pump — verify raw water availability before inspecting filters.',
    hyps: [
      { label: 'Low feed / raw tank emptying', prob: 68, status: 'supported' },
      { label: 'Cartridge filter clogged', prob: 16, status: 'rejected' },
      { label: 'RO membrane scaling', prob: 9, status: 'rejected' },
    ],
    gaugeTitle: 'Raw Water Tank TK-101 Level',
    gauges: [
      { val: 18, max: 100, unit: '%', label: 'RAW TANK LEVEL' },
      { val: 0.6, max: 4, unit: 'bar', label: 'FEED SUCTION' },
    ],
    readingSummary: 'Raw tank 18% (critically low) · Feed suction 0.6 bar (starved)',
    diagnosis: 'Raw water starvation. Filters and RO elements are healthy; borewell line supply has slumped.',
    actionTitle: 'Turn borewell supply valve V-2 to HALF open only (50%)',
    actionWhy: 'Refill raw tank gradually to avoid agitating settled sediment into the filtration train.',
  },
};

const DEFAULT_SIGNALS: Signal[] = [
  { tag: 'FIT-301', name: 'Permeate Flow', type: 'measurement', quantity: 'flow', unit: 'm³/h', range: [0, 12], limits: { nominal: 8.4, low_alarm: 5.0, low_trip: 3.0 } },
  { tag: 'FIT-101', name: 'Raw Feed Flow', type: 'measurement', quantity: 'flow', unit: 'm³/h', range: [0, 15], limits: { nominal: 12.0, low_alarm: 8.0 } },
  { tag: 'PIT-301', name: 'HP Pump Suction', type: 'measurement', quantity: 'pressure', unit: 'bar', range: [0, 6], limits: { nominal: 3.2, low_alarm: 1.8 } },
  { tag: 'PIT-302', name: 'HP Pump Discharge', type: 'measurement', quantity: 'pressure', unit: 'bar', range: [0, 20], limits: { nominal: 12.5, high_alarm: 15.5 } },
  { tag: 'AIT-301', name: 'Permeate TDS', type: 'measurement', quantity: 'tds', unit: 'ppm', range: [0, 100], limits: { nominal: 18, high_alarm: 35 } },
  { tag: 'JI-301', name: 'HP Motor Current', type: 'measurement', quantity: 'current', unit: 'A', range: [0, 15], limits: { nominal: 9.2, low_alarm: 7.5 } },
  { tag: 'YS-101', name: 'Feed Pump State', type: 'state', quantity: 'run_state', unit: '', range: [0, 1], limits: {}, state_labels: { '0': 'STOPPED', '1': 'RUNNING' } },
  { tag: 'YS-301', name: 'HP Pump State', type: 'state', quantity: 'run_state', unit: '', range: [0, 1], limits: {}, state_labels: { '0': 'STOPPED', '1': 'RUNNING' } },
  { tag: 'LSL-101', name: 'Raw Tank Low Switch', type: 'discrete', quantity: 'level_switch', unit: '', range: [0, 1], limits: {}, state_labels: { '0': 'NORMAL', '1': 'LOW_ALARM' } },
];

interface PlantContextType {
  signals: Signal[];
  readings: Record<string, Reading>;
  series: Record<string, number[]>;
  flags: Flag[];
  activeIncident: InvestigationDetail | null;
  activeScenario: DemoScenario | null;
  stepIndex: number;
  isRunningDemo: boolean;
  isBackendConnected: boolean;
  toastMessage: string | null;
  activeTab: 'console' | 'field' | 'studio' | 'twin';
  setActiveTab: (tab: 'console' | 'field' | 'studio' | 'twin') => void;
  showToast: (msg: string) => void;
  triggerScenario: (scenarioId: 'filter' | 'scaling' | 'feed') => void;
  advanceStep: () => void;
  resetPlant: () => void;
  submitFieldEvidence: () => void;
  approveActionProposal: () => void;
  completeValveAction: () => void;
}

const PlantContext = createContext<PlantContextType | null>(null);

export const PlantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<'console' | 'field' | 'studio' | 'twin'>('studio');
  const [signals, setSignals] = useState<Signal[]>(DEFAULT_SIGNALS);
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [series, setSeries] = useState<Record<string, number[]>>({});
  const [flags, setFlags] = useState<Flag[]>([]);
  const [activeIncident, setActiveIncident] = useState<InvestigationDetail | null>(null);
  const [activeScenario, setActiveScenario] = useState<DemoScenario | null>(null);
  const [stepIndex, setStepIndex] = useState<number>(-1);
  const [isRunningDemo, setIsRunningDemo] = useState<boolean>(false);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const curFlowRef = useRef<number>(8.4);
  const targetFlowRef = useRef<number>(8.4);
  const toastTimeoutRef = useRef<number | null>(null);
  const autoPlayTimersRef = useRef<number[]>([]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToastMessage(null), 3800);
  }, []);

  // Initialize readings
  useEffect(() => {
    const initReadings: Record<string, Reading> = {};
    const initSeries: Record<string, number[]> = {};
    DEFAULT_SIGNALS.forEach((s) => {
      const val = s.limits.nominal ?? (s.type === 'state' ? 1 : 0);
      initReadings[s.tag] = { observed_at: new Date().toISOString(), value: val, quality: 'good' };
      initSeries[s.tag] = Array.from({ length: 40 }, () => val);
    });
    setReadings(initReadings);
    setSeries(initSeries);
  }, []);

  // Continuous telemetry clock loop (HMI telemetry stream simulator)
  useEffect(() => {
    const interval = window.setInterval(() => {
      // Physics drift towards target
      curFlowRef.current += (targetFlowRef.current - curFlowRef.current) * 0.08 + (Math.random() - 0.5) * 0.06;
      const flow = Math.max(0, curFlowRef.current);

      setReadings((prev) => {
        const next = { ...prev };
        next['FIT-301'] = { observed_at: new Date().toISOString(), value: flow, quality: flow < 5 ? 'bad' : 'good' };
        next['FIT-101'] = { observed_at: new Date().toISOString(), value: 12.0 + (Math.random() - 0.5) * 0.2, quality: 'good' };
        next['PIT-301'] = { observed_at: new Date().toISOString(), value: flow < 5 ? 1.6 : 3.2 + (Math.random() - 0.5) * 0.05, quality: 'good' };
        next['PIT-302'] = { observed_at: new Date().toISOString(), value: flow < 5 ? 9.8 : 12.5 + (Math.random() - 0.5) * 0.1, quality: 'good' };
        next['AIT-301'] = { observed_at: new Date().toISOString(), value: flow < 5 ? 24 : 18 + (Math.random() - 0.5) * 0.4, quality: 'good' };
        next['JI-301'] = { observed_at: new Date().toISOString(), value: flow < 5 ? 7.4 : 9.2 + (Math.random() - 0.5) * 0.1, quality: 'good' };
        return next;
      });

      setSeries((prev) => {
        const next = { ...prev };
        const flowArr = [...(next['FIT-301'] || Array(40).fill(8.4))];
        flowArr.push(flow);
        if (flowArr.length > 50) flowArr.shift();
        next['FIT-301'] = flowArr;
        return next;
      });
    }, 600);

    return () => window.clearInterval(interval);
  }, []);

  // Try checking backend availability
  useEffect(() => {
    api.healthz()
      .then(() => setIsBackendConnected(true))
      .catch(() => setIsBackendConnected(false));
  }, []);

  const clearAutoTimers = () => {
    autoPlayTimersRef.current.forEach((t) => clearTimeout(t));
    autoPlayTimersRef.current = [];
  };

  const resetPlant = useCallback(() => {
    clearAutoTimers();
    targetFlowRef.current = 8.4;
    curFlowRef.current = 8.4;
    setStepIndex(-1);
    setIsRunningDemo(false);
    setActiveScenario(null);
    setActiveIncident(null);
    setFlags([]);
    showToast('Plant reset to nominal baseline.');
  }, [showToast]);

  const advanceStep = useCallback(() => {
    if (!activeScenario) return;
    setStepIndex((curr) => {
      const next = curr + 1;
      executeStep(activeScenario, next);
      return next;
    });
  }, [activeScenario]);

  const executeStep = (sc: DemoScenario, step: number) => {
    const timeStr = new Date().toLocaleTimeString();
    switch (step) {
      case 0: // Detect drift
        targetFlowRef.current = sc.targetFlow;
        setFlags([
          {
            id: 'FLAG-01',
            raised_at: new Date().toISOString(),
            severity: 'critical',
            status: 'active',
            summary: `Permeate flow FIT-301 dropped to ${sc.targetFlow} m³/h. Suction & current drift together without PLC alarm.`,
            tags: ['FIT-301', 'PIT-301', 'JI-301'],
            model: 'Muse Spark Open (Baseten)',
            incident_id: 'INC-201',
          },
        ]);
        setActiveIncident({
          incident: {
            incident_id: 'INC-201',
            title: sc.title,
            opened_at: timeStr,
            status: 'open',
          },
          investigation: {
            status: 'open',
            steps_used: 1,
            focus: {
              goal: 'Identify physical root cause of silent flow decline',
              blocker: 'Central digital sensors have no API for analogue gauge ΔP',
              next_step: 'Reason with Muse Wonder using plant SOP & memory',
              focus_assets: ['CF-201', 'RO-302', 'PMP-301'],
            },
          },
          hypotheses: sc.hyps.map((h, i) => ({
            id: `H-${i + 1}`,
            label: `Hypothesis ${i + 1}`,
            statement: h.label,
            status: 'suspected',
            probability: h.prob,
            evidence_for: [],
            evidence_against: [],
          })),
          field_tasks: [],
          trace: [
            { id: 't1', time: timeStr, actor: 'PLANT', kind: 'drift_alert', content: 'Telemetry drift detected by Spark watcher' },
            { id: 't2', time: timeStr, actor: 'WONDER', kind: 'investigation_start', content: 'Incident opened. Starting multi-hypothesis reasoning loop' },
          ],
        });
        showToast('Step 1: Spark watcher flagged telemetry drift. Incident opened.');
        break;

      case 1: // Reason & Form Hypotheses
        setActiveIncident((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            investigation: {
              ...prev.investigation,
              steps_used: 2,
              focus: {
                goal: 'Recall past incidents and evaluate SOP-07 differential pressure thresholds',
                blocker: 'Analogue gauges PG-1 & PG-2 have no digital bus',
                next_step: 'Dispatch bounded physical inspection task to Field Companion',
                focus_assets: ['CF-201', 'PG-1', 'PG-2'],
              },
            },
            trace: [
              ...prev.trace,
              { id: 't3', time: timeStr, actor: 'WONDER', kind: 'recall', content: `Recalled ${sc.memories.length} relevant historical memory records` },
              { id: 't4', time: timeStr, actor: 'WONDER', kind: 'focus_update', content: sc.focus },
            ],
          };
        });
        showToast('Step 2: Wonder recalled SOP-07 and locked focus on CF-201.');
        break;

      case 2: // Dispatch to Field Companion
        setActiveIncident((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            investigation: {
              ...prev.investigation,
              status: 'waiting_field',
              steps_used: 3,
              focus: {
                goal: 'Await physical dial gauge photo from technician',
                blocker: 'Awaiting operator straight-on gauge capture',
                next_step: 'Feed image into SAM 3.1 & Wonder dial reader',
                focus_assets: ['CF-201', 'PG-1', 'PG-2'],
              },
            },
            field_tasks: [
              {
                id: 'task-photo-01',
                kind: 'gauge_photo',
                status: 'pending',
                instruction: `Go to Cartridge Filter CF-201. Photograph dial gauges PG-1 (inlet) and PG-2 (outlet) straight-on.`,
                asset_ids: ['CF-201'],
                tags: ['PG-1', 'PG-2'],
              },
            ],
            trace: [
              ...prev.trace,
              { id: 't5', time: timeStr, actor: 'WONDER', kind: 'dispatch', content: 'Dispatched 1 bounded task to Field Companion (Operator on shift)' },
            ],
          };
        });
        showToast('Step 3: Bounded task dispatched to Field Companion phone.');
        break;

      case 3: // Gauge Evidence Arrives
        setActiveIncident((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            investigation: {
              ...prev.investigation,
              status: 'open',
              steps_used: 4,
            },
            field_tasks: [
              {
                id: 'task-photo-01',
                kind: 'gauge_photo',
                status: 'completed',
                instruction: 'Photograph dial gauges PG-1 and PG-2 on CF-201',
                asset_ids: ['CF-201'],
                tags: ['PG-1', 'PG-2'],
                result: {
                  readings: sc.gauges.map((g) => ({ tag: g.label, value: g.val, status: 'HIGH_CONFIDENCE' })),
                  voice: { transcript: 'Inlet PG-1 reading 3.4 bar, outlet PG-2 reading 1.8 bar.', comparison: { status: 'AGREE' } },
                },
              },
            ],
            trace: [
              ...prev.trace,
              { id: 't6', time: timeStr, actor: 'OPERATOR', kind: 'evidence_submit', content: 'Photo submitted from mobile Field Companion' },
              { id: 't7', time: timeStr, actor: 'ADK', kind: 'sam_segmentation', content: 'SAM 3.1 dial mask located (98% confidence) · Wonder dial reading: ' + sc.readingSummary },
            ],
          };
        });
        showToast('Step 4: SAM 3.1 isolated dial faces; Wonder read ΔP = 1.6 bar.');
        break;

      case 4: // Diagnose & Propose Action
        setActiveIncident((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            investigation: {
              ...prev.investigation,
              status: 'open',
              steps_used: 5,
              focus: {
                goal: 'Propose bounded remediation under SOP policy limits',
                blocker: 'Awaiting Human Commander Approval (Safety Interlock)',
                next_step: 'Commander authorizes half-open staged bypass valve move',
                focus_assets: ['V-113', 'CF-201'],
              },
            },
            hypotheses: [
              { id: 'H-1', label: 'Hypothesis 1', statement: sc.hyps[0].label, status: 'confirmed', probability: 94, evidence_for: [sc.readingSummary] },
              { id: 'H-2', label: 'Hypothesis 2', statement: sc.hyps[1].label, status: 'rejected', probability: 4, evidence_against: ['Differential pressure localized at filter bank'] },
              { id: 'H-3', label: 'Hypothesis 3', statement: sc.hyps[2].label, status: 'rejected', probability: 2, evidence_against: ['Feed suction pressure PIT-301 nominal'] },
            ],
            action_proposals: [
              {
                id: 'prop-01',
                action: sc.actionTitle,
                asset_id: 'V-113',
                rationale: sc.actionWhy,
                status: 'pending',
              },
            ],
            trace: [
              ...prev.trace,
              { id: 't8', time: timeStr, actor: 'WONDER', kind: 'diagnosis', content: sc.diagnosis },
              { id: 't9', time: timeStr, actor: 'WONDER', kind: 'proposal', content: `Proposed Action: ${sc.actionTitle}. Waiting for Commander authorization.` },
            ],
          };
        });
        showToast('Step 5: Diagnosis confirmed. Proposed valve action waiting for approval.');
        break;

      case 5: // Commander Approves & Dispatches Valve Task
        setActiveIncident((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            investigation: {
              ...prev.investigation,
              status: 'waiting_field',
              steps_used: 6,
              focus: {
                goal: 'Operator executes staged valve move with camera perpendicular',
                blocker: 'Awaiting SAM 3.1 video angle verification',
                next_step: 'Verify staged 0° -> 45° (hold 2s) -> 90° motion',
                focus_assets: ['V-113'],
              },
            },
            action_proposals: (prev.action_proposals || []).map((p) => ({ ...p, status: 'approved' })),
            field_tasks: [
              ...prev.field_tasks,
              {
                id: 'task-valve-02',
                kind: 'valve_action',
                status: 'pending',
                instruction: 'Turn valve V-113 to HALF (45°) hold for 2s, then verify perpendicular video clip.',
                asset_ids: ['V-113'],
                tags: ['V-113'],
              },
            ],
            trace: [
              ...prev.trace,
              { id: 't10', time: timeStr, actor: 'ADK', kind: 'approval', content: 'Commander approved action proposal' },
              { id: 't11', time: timeStr, actor: 'WONDER', kind: 'dispatch', content: 'Dispatched staged valve action to Field Companion' },
            ],
          };
        });
        showToast('Step 6: Commander approved valve task. Sent to Field Companion.');
        break;

      case 6: // SAM 3.1 Verifies Valve Handle Angle
        setActiveIncident((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            investigation: {
              ...prev.investigation,
              status: 'verifying',
              steps_used: 7,
              focus: {
                goal: 'Continuous telemetry verifier watching flow recovery over 30s window',
                blocker: 'Sustained healthy flow & pressure window required',
                next_step: 'Verifier code closes incident once nominal telemetry is sustained',
                focus_assets: ['FIT-301', 'PIT-302'],
              },
            },
            field_tasks: prev.field_tasks.map((t) =>
              t.id === 'task-valve-02'
                ? {
                    ...t,
                    status: 'completed',
                    result: {
                      policy: {
                        status: 'PASS',
                        stages_seen: ['0° (OPEN)', '45° (HOLD 2.4s)', '90° (CLOSED)'],
                        reasons: ['No water hammer detected', 'Staged motion compliant with SOP-07'],
                      },
                    },
                  }
                : t,
            ),
            trace: [
              ...prev.trace,
              { id: 't12', time: timeStr, actor: 'OPERATOR', kind: 'video_submit', content: 'Submitted valve action clip (30 FPS)' },
              { id: 't13', time: timeStr, actor: 'VERIFIER', kind: 'sam_verification', content: 'SAM 3.1 handle angle verified: 45° hold confirmed (2.4s). Policy PASS.' },
            ],
          };
        });
        showToast('Step 7: SAM verified valve handle angle. Watching flow recovery…');
        break;

      case 7: // Telemetry Recovery & Verified Resolution
        targetFlowRef.current = 8.4;
        setFlags([]);
        setActiveIncident((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            incident: {
              ...prev.incident,
              status: 'resolved',
            },
            investigation: {
              ...prev.investigation,
              status: 'resolved',
              steps_used: 8,
              focus: {
                goal: 'Incident resolved and verified by sustained telemetry',
                blocker: 'None. All sensors nominal.',
                next_step: 'Routine shift monitoring resumed',
                focus_assets: [],
              },
            },
            trace: [
              ...prev.trace,
              { id: 't14', time: timeStr, actor: 'PLANT', kind: 'flow_recovery', content: 'Flow FIT-301 restored to 8.4 m³/h. Pressure differential nominal.' },
              { id: 't15', time: timeStr, actor: 'VERIFIER', kind: 'close_incident', content: 'Deterministic verifier confirmed 30s sustained recovery. INCIDENT RESOLVED.' },
            ],
          };
        });
        showToast('Step 8: RESOLVED — Verified by sustained telemetry recovery!');
        break;
    }
  };

  const triggerScenario = useCallback((scenarioId: 'filter' | 'scaling' | 'feed') => {
    clearAutoTimers();
    const sc = SCENARIOS[scenarioId];
    setActiveScenario(sc);
    setIsRunningDemo(true);
    setStepIndex(0);
    executeStep(sc, 0);

    // Auto-advance through the 8 stages for a seamless recording experience
    const delays = [3200, 3400, 3600, 3600, 3400, 3600, 4200];
    let cumulative = 0;
    delays.forEach((delay, idx) => {
      cumulative += delay;
      const timer = window.setTimeout(() => {
        setStepIndex((curr) => {
          const next = idx + 1;
          executeStep(sc, next);
          return next;
        });
      }, cumulative);
      autoPlayTimersRef.current.push(timer);
    });
  }, []);

  const submitFieldEvidence = useCallback(() => {
    if (stepIndex === 2) advanceStep();
  }, [stepIndex, advanceStep]);

  const approveActionProposal = useCallback(() => {
    if (stepIndex === 4) advanceStep();
  }, [stepIndex, advanceStep]);

  const completeValveAction = useCallback(() => {
    if (stepIndex === 5) advanceStep();
  }, [stepIndex, advanceStep]);

  return (
    <PlantContext.Provider
      value={{
        signals,
        readings,
        series,
        flags,
        activeIncident,
        activeScenario,
        stepIndex,
        isRunningDemo,
        isBackendConnected,
        toastMessage,
        activeTab,
        setActiveTab,
        showToast,
        triggerScenario,
        advanceStep,
        resetPlant,
        submitFieldEvidence,
        approveActionProposal,
        completeValveAction,
      }}
    >
      {children}
    </PlantContext.Provider>
  );
};

export const usePlant = () => {
  const context = useContext(PlantContext);
  if (!context) throw new Error('usePlant must be used within PlantProvider');
  return context;
};

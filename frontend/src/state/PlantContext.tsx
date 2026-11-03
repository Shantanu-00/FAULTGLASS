import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { errorMessage } from '../lib/format';
import type {
  Flag,
  IncidentDetail,
  IncidentSummary,
  PlantInfo,
  Reading,
  RunDiagnostics,
  SeriesPoint,
  TelemetryRow,
} from '../types';
import { clockSpeedFromUrl } from './route';

export type Connection = 'connecting' | 'online' | 'offline';
export type FeedMode = 'idle' | 'stream' | 'polling';

const WINDOW_MS = 5 * 60 * 1000;
const PRODUCTION_WINDOW_MS = 60 * 60 * 1000;
const BASELINE_SIM_S = 120;
const MIN_LEARNED_POINTS = 3;
const FLUSH_MS = 250;

export interface Baseline {
  value: number;
  source: 'learned' | 'nominal';
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

interface PlantContextValue {
  connection: Connection;
  connectionError: string | null;
  retry: () => void;
  plant: PlantInfo | null;
  feed: FeedMode;
  lastUpdate: number | null;
  readings: Record<string, Reading>;
  series: Record<string, SeriesPoint[]>;
  run: RunDiagnostics | null;
  runLoaded: boolean;
  flags: Flag[];
  hiddenFlagCount: number;
  incidents: IncidentSummary[];
  selectedIncidentId: string | null;
  selectIncident: (id: string) => void;
  incident: IncidentDetail | null;
  refreshIncident: () => Promise<void>;
  baselines: Record<string, Baseline>;
  injectBlockage: () => Promise<void>;
  resetRun: () => Promise<void>;
  recordBackwash: () => Promise<void>;
  busy: { inject: boolean; reset: boolean };
  toast: Toast | null;
  notify: (message: string, tone?: Toast['tone']) => void;
}

const PlantContext = createContext<PlantContextValue | null>(null);

export function usePlant(): PlantContextValue {
  const value = useContext(PlantContext);
  if (!value) throw new Error('usePlant must be used inside PlantProvider');
  return value;
}

function learnedMeans(learn: Record<string, Map<number, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [tag, points] of Object.entries(learn)) {
    if (points.size < MIN_LEARNED_POINTS) continue;
    let sum = 0;
    for (const v of points.values()) sum += v;
    out[tag] = sum / points.size;
  }
  return out;
}

interface ProviderProps {
  children: React.ReactNode;
  wantTelemetry: boolean;
  autoStartRun: boolean;
}

export const PlantProvider: React.FC<ProviderProps> = ({ children, wantTelemetry, autoStartRun }) => {
  const [connection, setConnection] = useState<Connection>('connecting');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [plant, setPlant] = useState<PlantInfo | null>(null);
  const [feed, setFeed] = useState<FeedMode>('idle');
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<{ readings: Record<string, Reading>; series: Record<string, SeriesPoint[]> }>({
    readings: {},
    series: {},
  });
  const [run, setRun] = useState<RunDiagnostics | null>(null);
  const [runLoaded, setRunLoaded] = useState(false);
  const [allFlags, setAllFlags] = useState<Flag[]>([]);
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState({ inject: false, reset: false });
  const [learned, setLearned] = useState<Record<string, number>>({});

  const learnRef = useRef<Record<string, Map<number, number>>>({});
  const learnEndRef = useRef(Infinity);
  const runIdRef = useRef<string | null>(null);
  const runJsonRef = useRef('');
  const readingsRef = useRef<Record<string, Reading>>({});
  const seriesRef = useRef<Record<string, SeriesPoint[]>>({});
  const flushTimer = useRef<number | null>(null);
  const runStartRef = useRef(0);
  const failures = useRef(0);
  const starting = useRef(false);
  const toastTimer = useRef<number | null>(null);

  const notify = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    setToast({ id: Date.now(), message, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);

  // ---- connection and plant ------------------------------------------------
  const loadPlant = useCallback(async () => {
    try {
      const info = await api.plant();
      failures.current = 0;
      setPlant(info);
      setConnection('online');
      setConnectionError(null);
    } catch (error) {
      setConnection('offline');
      setConnectionError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void loadPlant();
  }, [loadPlant]);

  useEffect(() => {
    if (plant || connection !== 'offline') return;
    const timer = window.setInterval(() => void loadPlant(), 5000);
    return () => window.clearInterval(timer);
  }, [plant, connection, loadPlant]);

  const retry = useCallback(() => {
    setConnection((c) => (c === 'offline' ? 'connecting' : c));
    void loadPlant();
  }, [loadPlant]);

  // ---- run -----------------------------------------------------------------
  const adoptRun = useCallback((next: RunDiagnostics | null) => {
    const previous = runIdRef.current;
    runIdRef.current = next?.id ?? null;
    runStartRef.current = next ? Date.parse(next.started_at) : 0;
    learnEndRef.current = next
      ? next.baseline_ready_at
        ? Date.parse(next.baseline_ready_at)
        : runStartRef.current + (BASELINE_SIM_S * 1000) / Math.max(next.clock_speed, 1)
      : Infinity;
    if (next && previous !== next.id) {
      if (previous) {
        // A replaced run starts a new curve: nothing from the old one may stay on screen.
        readingsRef.current = {};
        seriesRef.current = {};
        learnRef.current = {};
        setLearned({});
        setSnapshot({ readings: {}, series: {} });
      } else {
        for (const [tag, reading] of Object.entries(readingsRef.current)) {
          if (reading.run_id && reading.run_id !== next.id) delete readingsRef.current[tag];
        }
        for (const [tag, points] of Object.entries(seriesRef.current)) {
          seriesRef.current[tag] = points.filter((p) => p.t >= runStartRef.current);
        }
      }
    }
    const json = JSON.stringify(next);
    if (json !== runJsonRef.current) {
      runJsonRef.current = json;
      setRun(next);
    }
  }, []);

  const refreshRun = useCallback(async () => {
    try {
      const { run: current } = await api.currentRun();
      failures.current = 0;
      adoptRun(current);
      setRunLoaded(true);
      setConnection('online');
      setConnectionError(null);
      return current;
    } catch (error) {
      failures.current += 1;
      if (failures.current >= 2) {
        setConnection('offline');
        setConnectionError(errorMessage(error));
      }
      return undefined;
    }
  }, [adoptRun]);

  useEffect(() => {
    if (!plant) return;
    void refreshRun();
    const timer = window.setInterval(() => void refreshRun(), 2000);
    return () => window.clearInterval(timer);
  }, [plant, refreshRun]);

  const beginRun = useCallback(async () => {
    try {
      adoptRun(await api.startRun(clockSpeedFromUrl()));
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409)) throw error;
    }
  }, [adoptRun]);

  useEffect(() => {
    if (!autoStartRun || !plant?.simulation || !runLoaded || run || starting.current || connection !== 'online') return;
    starting.current = true;
    beginRun()
      .then(() => refreshRun())
      .catch((error) => notify(errorMessage(error), 'error'))
      .finally(() => {
        starting.current = false;
      });
  }, [autoStartRun, plant, runLoaded, run, connection, beginRun, refreshRun, notify]);

  const runId = run?.id;
  const baselineReadyAt = run?.baseline_ready_at;
  useEffect(() => {
    if (baselineReadyAt) learnEndRef.current = Date.parse(baselineReadyAt);
  }, [baselineReadyAt]);

  useEffect(() => {
    if (!runId) return;
    const timer = window.setInterval(() => {
      // A run replaced from another tab answers 404 here; adopt whatever run is current.
      api.heartbeat(runId).catch(() => void refreshRun());
    }, 10000);
    return () => window.clearInterval(timer);
  }, [runId, refreshRun]);

  const injectBlockage = useCallback(async () => {
    if (!run) return;
    setBusy((b) => ({ ...b, inject: true }));
    try {
      await api.sendEvent(run.id, 'scenario', { name: 'production_decline' });
    } catch (error) {
      notify(error instanceof ApiError && error.status === 409 ? 'The baseline is still being learned, or a scenario is already active.' : errorMessage(error), 'error');
    } finally {
      await refreshRun();
      setBusy((b) => ({ ...b, inject: false }));
    }
  }, [run, notify, refreshRun]);

  const recordBackwash = useCallback(async () => {
    if (!run) return;
    try {
      await api.sendEvent(run.id, 'valve_action', { action: 'backwash_completed' });
    } catch (error) {
      notify(errorMessage(error), 'error');
    }
    await refreshRun();
  }, [run, notify, refreshRun]);

  const resetRun = useCallback(async () => {
    setBusy((b) => ({ ...b, reset: true }));
    try {
      adoptRun(await api.resetRun(clockSpeedFromUrl()));
      setPickedId(null);
      setIncident(null);
      setIncidents([]);
      setAllFlags([]);
      notify('Run reset. The plant is learning its baseline again.');
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      await refreshRun();
      setBusy((b) => ({ ...b, reset: false }));
    }
  }, [adoptRun, notify, refreshRun]);

  // ---- flags and incidents -------------------------------------------------
  useEffect(() => {
    if (!plant) return;
    const load = async () => {
      try {
        setAllFlags((await api.flags()).flags);
      } catch {
        /* the run poll reports connectivity */
      }
      try {
        setIncidents((await api.incidents()).incidents);
      } catch {
        /* the run poll reports connectivity */
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [plant]);

  useEffect(() => setPickedId(null), [runId]);

  const selectedIncidentId = useMemo(() => {
    if (pickedId && incidents.some((i) => i.incident_id === pickedId)) return pickedId;
    const startedAt = run ? Date.parse(run.started_at) : null;
    const pool = startedAt === null ? incidents : incidents.filter((i) => Date.parse(i.opened_at) >= startedAt - 1000);
    const open = pool.find((i) => i.status === 'open');
    return (open ?? pool[0])?.incident_id ?? null;
  }, [pickedId, incidents, run]);

  const refreshIncident = useCallback(async () => {
    if (!selectedIncidentId) {
      setIncident(null);
      return;
    }
    try {
      setIncident(await api.incident(selectedIncidentId));
    } catch {
      /* keep the last detail; connectivity is tracked by the run poll */
    }
  }, [selectedIncidentId]);

  useEffect(() => {
    setIncident((current) => (current?.incident.incident_id === selectedIncidentId ? current : null));
    if (!plant || !selectedIncidentId) return;
    void refreshIncident();
    const timer = window.setInterval(() => void refreshIncident(), 3000);
    return () => window.clearInterval(timer);
  }, [plant, selectedIncidentId, refreshIncident]);

  const flags = useMemo(() => (run ? allFlags.filter((f) => f.run_id === run.id) : allFlags), [allFlags, run]);

  const baselines = useMemo(() => {
    const out: Record<string, Baseline> = {};
    for (const signal of plant?.signals ?? []) {
      if (signal.type !== 'measurement') continue;
      if (learned[signal.tag] !== undefined) out[signal.tag] = { value: learned[signal.tag], source: 'learned' };
      else if (signal.limits.nominal !== undefined) out[signal.tag] = { value: signal.limits.nominal, source: 'nominal' };
    }
    for (const [tag, evidence] of Object.entries(incident?.flag?.evidence?.signals ?? {})) {
      if (typeof evidence.baseline === 'number') out[tag] = { value: evidence.baseline, source: 'learned' };
    }
    return out;
  }, [plant, learned, incident]);
  const hiddenFlagCount = allFlags.length - flags.length;

  // ---- telemetry -----------------------------------------------------------
  useEffect(() => {
    if (!plant || !wantTelemetry) {
      setFeed('idle');
      return;
    }
    let cancelled = false;
    let source: EventSource | null = null;
    let pollTimer: number | null = null;

    const learn = (tag: string, t: number, v: number) => {
      if (t > learnEndRef.current) return;
      (learnRef.current[tag] ??= new Map()).set(t, v);
    };

    const flush = () => {
      flushTimer.current = null;
      setLearned(learnedMeans(learnRef.current));
      setSnapshot({
        readings: { ...readingsRef.current },
        series: Object.fromEntries(Object.entries(seriesRef.current).map(([tag, pts]) => [tag, pts.slice()])),
      });
    };
    const schedule = () => {
      if (flushTimer.current === null) flushTimer.current = window.setTimeout(flush, FLUSH_MS);
    };

    const applyRows = (rows: TelemetryRow[]) => {
      for (const row of rows) {
        if (runIdRef.current && row.run_id && row.run_id !== runIdRef.current) continue;
        const previous = readingsRef.current[row.tag];
        if (previous && previous.observed_at > row.observed_at) continue;
        readingsRef.current[row.tag] = {
          value: row.value,
          quality: row.quality,
          observed_at: row.observed_at,
          run_id: row.run_id ?? null,
        };
        if (row.value === null || !Number.isFinite(row.value) || row.quality !== 'good') continue;
        const t = Date.parse(row.observed_at);
        if (t < runStartRef.current) continue;
        learn(row.tag, t, row.value);
        const line = (seriesRef.current[row.tag] ??= []);
        if (!line.length || line[line.length - 1].t < t) line.push({ t, v: row.value });
        // Keep the production decline and recovery together while field work takes place.
        const cutoff = t - (row.tag === 'FIT-301' ? PRODUCTION_WINDOW_MS : WINDOW_MS);
        while (line.length && line[0].t < cutoff) line.shift();
      }
      setLastUpdate(Date.now());
      schedule();
    };

    const pollLatest = async () => {
      try {
        applyRows((await api.latest()).readings);
      } catch {
        /* the run poll reports connectivity */
      }
    };

    (async () => {
      try {
        applyRows((await api.latest()).readings);
        await Promise.all(
          plant.signals
            .filter((s) => s.type === 'measurement')
            .map(async (s) => {
              const { points } = s.tag === 'FIT-301'
                ? await api.history(s.tag, 3600, 3600)
                : await api.history(s.tag);
              if (cancelled) return;
              const merged = points
                .filter((p) => p.value !== null && Number.isFinite(p.value) && p.quality === 'good')
                .map((p) => ({ t: Date.parse(p.observed_at), v: p.value as number }))
                .filter((p) => p.t >= runStartRef.current);
              for (const p of merged) learn(s.tag, p.t, p.v);
              const live = seriesRef.current[s.tag] ?? [];
              const lastHistory = merged.length ? merged[merged.length - 1].t : -Infinity;
              seriesRef.current[s.tag] = [...merged, ...live.filter((p) => p.t > lastHistory)];
            }),
        );
        if (!cancelled) schedule();
      } catch {
        /* the stream and the run poll continue */
      }
      if (cancelled) return;
      setFeed('polling');
      source = new EventSource(api.streamUrl());
      source.addEventListener('open', () => {
        if (pollTimer !== null) window.clearInterval(pollTimer);
        pollTimer = null;
        setFeed('stream');
      });
      source.addEventListener('telemetry', (event) => applyRows(JSON.parse((event as MessageEvent).data)));
      source.addEventListener('error', () => {
        setFeed('polling');
        if (pollTimer === null) pollTimer = window.setInterval(() => void pollLatest(), 2000);
      });
    })();

    return () => {
      cancelled = true;
      source?.close();
      if (pollTimer !== null) window.clearInterval(pollTimer);
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
      setFeed('idle');
    };
  }, [plant, wantTelemetry]);

  const value = useMemo<PlantContextValue>(
    () => ({
      connection,
      connectionError,
      retry,
      plant,
      feed,
      lastUpdate,
      readings: snapshot.readings,
      series: snapshot.series,
      run,
      runLoaded,
      flags,
      hiddenFlagCount,
      incidents,
      selectedIncidentId,
      selectIncident: setPickedId,
      incident,
      refreshIncident,
      baselines,
      injectBlockage,
      resetRun,
      recordBackwash,
      busy,
      toast,
      notify,
    }),
    [
      connection, connectionError, retry, plant, feed, lastUpdate, snapshot, run, runLoaded, flags,
      hiddenFlagCount, incidents, selectedIncidentId, incident, refreshIncident, baselines,
      injectBlockage, resetRun, recordBackwash, busy, toast, notify,
    ],
  );

  return <PlantContext.Provider value={value}>{children}</PlantContext.Provider>;
};

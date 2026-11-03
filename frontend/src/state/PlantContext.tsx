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
const FLUSH_MS = 250;

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
  injectDecline: () => Promise<void>;
  restartRun: () => Promise<void>;
  recordBackwash: () => Promise<void>;
  toast: Toast | null;
  notify: (message: string, tone?: Toast['tone']) => void;
}

const PlantContext = createContext<PlantContextValue | null>(null);

export function usePlant(): PlantContextValue {
  const value = useContext(PlantContext);
  if (!value) throw new Error('usePlant must be used inside PlantProvider');
  return value;
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
  const refreshRun = useCallback(async () => {
    try {
      const { run: current } = await api.currentRun();
      failures.current = 0;
      setRun(current);
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
  }, []);

  useEffect(() => {
    if (!plant) return;
    void refreshRun();
    const timer = window.setInterval(() => void refreshRun(), 2000);
    return () => window.clearInterval(timer);
  }, [plant, refreshRun]);

  const beginRun = useCallback(async () => {
    try {
      await api.startRun(clockSpeedFromUrl());
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409)) throw error;
    }
  }, []);

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
  const runStartedAt = run?.started_at;
  useEffect(() => {
    // A new run starts a new curve: keep the sparklines to the active run only.
    runStartRef.current = runStartedAt ? Date.parse(runStartedAt) : 0;
    for (const [tag, points] of Object.entries(seriesRef.current)) {
      seriesRef.current[tag] = points.filter((p) => p.t >= runStartRef.current);
    }
  }, [runStartedAt]);
  useEffect(() => {
    if (!runId) return;
    const timer = window.setInterval(() => api.heartbeat(runId).catch(() => undefined), 10000);
    return () => window.clearInterval(timer);
  }, [runId]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await refreshRun();
      } catch (error) {
        notify(errorMessage(error), 'error');
      }
    },
    [refreshRun, notify],
  );

  const injectDecline = useCallback(
    () => act(async () => run && api.sendEvent(run.id, 'scenario', { name: 'production_decline' })),
    [act, run],
  );
  const recordBackwash = useCallback(
    () => act(async () => run && api.sendEvent(run.id, 'valve_action', { action: 'backwash_completed' })),
    [act, run],
  );
  const restartRun = useCallback(
    () =>
      act(async () => {
        if (run) await api.stopRun(run.id);
        await beginRun();
      }),
    [act, run, beginRun],
  );

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

    const flush = () => {
      flushTimer.current = null;
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
        const previous = readingsRef.current[row.tag];
        if (previous && previous.observed_at > row.observed_at) continue;
        readingsRef.current[row.tag] = {
          value: row.value,
          quality: row.quality,
          observed_at: row.observed_at,
          run_id: row.run_id ?? null,
        };
        if (row.value === null) continue;
        const t = Date.parse(row.observed_at);
        if (t < runStartRef.current) continue;
        const line = (seriesRef.current[row.tag] ??= []);
        if (!line.length || line[line.length - 1].t < t) line.push({ t, v: row.value });
        const cutoff = t - WINDOW_MS;
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
              const { points } = await api.history(s.tag);
              if (cancelled) return;
              const merged = points
                .filter((p) => p.value !== null)
                .map((p) => ({ t: Date.parse(p.observed_at), v: p.value as number }))
                .filter((p) => p.t >= runStartRef.current);
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
      injectDecline,
      restartRun,
      recordBackwash,
      toast,
      notify,
    }),
    [
      connection, connectionError, retry, plant, feed, lastUpdate, snapshot, run, runLoaded, flags,
      hiddenFlagCount, incidents, selectedIncidentId, incident, refreshIncident, injectDecline,
      restartRun, recordBackwash, toast, notify,
    ],
  );

  return <PlantContext.Provider value={value}>{children}</PlantContext.Provider>;
};

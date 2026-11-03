import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ApiUnreachable } from '../components/common/ApiUnreachable';
import { ConnectionBanner } from '../components/common/ConnectionBanner';
import { Pill } from '../components/common/Pill';
import { labelFor } from '../lib/signals';
import { usePlant } from '../state/PlantContext';
// @ts-expect-error plantScene is plain JavaScript
import { createPlantScene } from '../scene/plantScene';
import '../styles/twin.css';

interface SceneModel {
  instruments: Array<{ tag: string; attach: { asset?: string; port?: string; span?: string[] } }>;
}

interface Scene {
  model: SceneModel;
  setInstrument: (tag: string, value: number | null) => void;
  highlight: (ids: string[], kind: string) => void;
  setObservability: (on: boolean) => void;
  flyTo: (preset: string) => void;
  dispose: () => void;
  on: (name: string, fn: (payload: { assetId?: string; tag?: string | null }) => void) => () => void;
}

const PRESETS: Array<{ id: string; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'cartridge', label: 'Cartridge bank' },
  { id: 'gauges', label: 'Front gauges' },
  { id: 'media', label: 'Media filters' },
  { id: 'backwash', label: 'Backwash valves' },
  { id: 'ro', label: 'RO skid' },
  { id: 'hp_pump', label: 'HP pump' },
];

export const TwinView: React.FC = () => {
  const { plant, readings: latest, flags, incident, run } = usePlant();
  // A reading from an earlier run is history, not the plant's current state.
  const readings = useMemo(
    () => Object.fromEntries(Object.entries(latest).filter(([, r]) => !run || r.run_id === run.id)),
    [latest, run],
  );
  const container = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preset, setPreset] = useState('overview');
  const [observability, setObservability] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const host = container.current;
    if (!host || !plant) return;
    let disposed = false;
    fetch('/plants/waterplant.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((model) => {
        if (disposed) return;
        const scene: Scene = createPlantScene(host, model);
        scene.on('select', ({ assetId, tag }) => setSelected(tag ?? assetId ?? null));
        sceneRef.current = scene;
        setReady(true);
      })
      .catch((error: Error) => !disposed && setLoadError(`The plant model could not be loaded (${error.message}).`));
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, [plant]);

  const signalByTag = useMemo(() => new Map((plant?.signals ?? []).map((s) => [s.tag, s])), [plant]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !ready) return;
    for (const [tag, reading] of Object.entries(readings)) scene.setInstrument(tag, reading.value);
  }, [readings, ready]);

  const flaggedTags = useMemo(
    () => new Set(flags.filter((f) => f.status === 'open' || f.status === 'picked_up').flatMap((f) => f.tags)),
    [flags],
  );

  const taskAssets = useMemo(
    () => (incident?.field_tasks ?? []).filter((t) => t.status === 'pending').flatMap((t) => [...t.asset_ids, ...t.tags]),
    [incident],
  );
  const focusAssets = incident?.investigation.focus?.focus_assets ?? [];

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !ready) return;
    scene.highlight(focusAssets, 'focus');
    scene.highlight(taskAssets, 'task');
  }, [ready, focusAssets.join('|'), taskAssets.join('|')]);

  const flaggedHosts = useMemo(() => {
    const scene = sceneRef.current;
    if (!scene || !ready) return [] as string[];
    const hosts = new Set<string>();
    for (const tag of flaggedTags) {
      const at = scene.model.instruments.find((i) => i.tag === tag)?.attach;
      const host = at?.asset ?? at?.port?.split('.')[0] ?? at?.span?.[0].split('.')[0];
      if (host) hosts.add(host);
    }
    return [...hosts];
  }, [flaggedTags, ready]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.highlight(flaggedHosts, 'warning');
  }, [ready, flaggedHosts.join('|')]);

  // Field readings from gauge photos arrive as ordinary telemetry rows; the scene shows each PI-* dial once read.
  const fieldReadings = useMemo(
    () =>
      Object.entries(readings)
        .filter(([tag, r]) => !signalByTag.has(tag) && r.value !== null)
        .sort(([a], [b]) => a.localeCompare(b)),
    [readings, signalByTag],
  );


  if (!plant) return <ApiUnreachable />;

  const goto = (id: string) => {
    setPreset(id);
    sceneRef.current?.flyTo(id);
  };

  return (
    <div className="twin">
      <ConnectionBanner />
      <div className="twin-stage">
        <div className="twin-canvas" ref={container}>
          {loadError && (
            <div className="twin-error" role="alert">
              {loadError}
            </div>
          )}
        </div>
        <aside className="twin-panel">
          <section>
            <h2 className="panel-title">Camera</h2>
            <div className="preset-grid">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className={`btn btn-small${preset === p.id ? ' is-selected' : ''}`} onClick={() => goto(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={observability}
                onChange={(e) => {
                  setObservability(e.target.checked);
                  sceneRef.current?.setObservability(e.target.checked);
                }}
              />
              <span>Show which instruments have an API</span>
            </label>
          </section>

          <section>
            <div className="panel-head">
              <h2 className="panel-title">Live values</h2>
              {plant.simulation && <Pill tone="warning">Simulated</Pill>}
            </div>
            {!run && plant.simulation && <p className="muted small">No active run. Open the Operator view to start the plant feed.</p>}
            <ul className="twin-readings">
              {plant.signals
                .filter((s) => s.type === 'measurement')
                .map((s) => {
                  const r = readings[s.tag];
                  return (
                    <li key={s.tag} className={flaggedTags.has(s.tag) ? 'is-flagged' : ''}>
                      <code className="tag">{s.tag}</code>
                      <span className="num strong">{r && r.value !== null ? r.value.toFixed(s.unit === 'L/h' ? 0 : 1) : '-'}</span>
                      <span className="muted small">{s.unit}</span>
                    </li>
                  );
                })}
              {plant.signals
                .filter((s) => s.type !== 'measurement')
                .map((s) => {
                  const r = readings[s.tag];
                  const label = r && r.value !== null ? labelFor(s, r.value) : undefined;
                  return (
                    <li key={s.tag}>
                      <code className="tag">{s.tag}</code>
                      <span className="strong">{label ? label.replace(/_/g, ' ').toLowerCase() : '-'}</span>
                    </li>
                  );
                })}
            </ul>
          </section>

          <section>
            <h2 className="panel-title">Field gauge readings</h2>
            {fieldReadings.length === 0 ? (
              <p className="muted small">No gauge has been read yet. Readings appear here after a field photo is accepted.</p>
            ) : (
              <ul className="twin-readings">
                {fieldReadings.map(([tag, r]) => (
                  <li key={tag}>
                    <code className="tag">{tag}</code>
                    <span className="num strong">{(r.value as number).toFixed(1)}</span>
                    <span className="muted small">psi</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {selected && (
            <section>
              <h2 className="panel-title">Selected</h2>
              <code className="tag">{selected}</code>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
};

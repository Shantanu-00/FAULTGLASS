import React, { useMemo, useRef, useState } from 'react';
import { ApiUnreachable } from '../components/common/ApiUnreachable';
import { ConnectionBanner } from '../components/common/ConnectionBanner';
import { Pill } from '../components/common/Pill';
import { CameraPresets } from '../components/twin/CameraPresets';
import { PlantTwin, type PlantTwinHandle } from '../components/twin/PlantTwin';
import { TwinLegend } from '../components/twin/TwinLegend';
import { labelFor } from '../lib/signals';
import { usePlant } from '../state/PlantContext';
import { useTwinState } from '../state/useTwinState';
import '../styles/twin.css';

export const TwinView: React.FC = () => {
  const { plant, readings: latest, run } = usePlant();
  const { flaggedTags, warningAssets, targets } = useTwinState();
  const flagged = useMemo(() => new Set(flaggedTags), [flaggedTags]);
  // A reading from an earlier run is history, not the plant's current state.
  const readings = useMemo(
    () => Object.fromEntries(Object.entries(latest).filter(([, r]) => !run || r.run_id === run.id)),
    [latest, run],
  );
  const twin = useRef<PlantTwinHandle | null>(null);
  const [preset, setPreset] = useState('overview');
  const [observability, setObservability] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const signalByTag = useMemo(() => new Map((plant?.signals ?? []).map((s) => [s.tag, s])), [plant]);

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
    twin.current?.flyTo(id);
  };

  return (
    <div className="twin">
      <ConnectionBanner />
      <div className="twin-stage">
        <div className="twin-stage-main">
          <PlantTwin ref={twin} targets={targets} warningAssets={warningAssets} observability={observability} onSelect={setSelected} />
          <TwinLegend targets={targets} hasFlag={flaggedTags.length > 0} />
        </div>
        <aside className="twin-panel">
          <section>
            <h2 className="panel-title">Camera</h2>
            <CameraPresets current={preset} onPick={goto} />
            <label className="check-row">
              <input
                type="checkbox"
                checked={observability}
                onChange={(e) => setObservability(e.target.checked)}
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
                    <li key={s.tag} className={flagged.has(s.tag) ? 'is-flagged' : ''}>
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

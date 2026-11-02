import React, { useEffect, useRef, useState } from 'react';
// @ts-expect-error plantScene is pure JS
import { createPlantScene } from '../../scene/plantScene';

export const PlantTwinView: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneInstanceRef = useRef<any>(null);
  const [activePreset, setActivePreset] = useState<string>('overview');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    fetch('/plants/waterplant.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((model) => {
        if (!containerRef.current) return;
        const scene = createPlantScene(containerRef.current, model);
        sceneInstanceRef.current = scene;
      })
      .catch((err) => {
        setLoadError(`3D model unavailable: ${err.message}`);
      });

    return () => {
      sceneInstanceRef.current?.dispose?.();
    };
  }, []);

  const flyTo = (preset: string) => {
    setActivePreset(preset);
    sceneInstanceRef.current?.flyTo?.(preset);
  };

  return (
    <div style={{ height: 'calc(100vh - 180px)', display: 'grid', gridTemplateColumns: '1fr 280px', borderTop: '1.5px solid #22252A' }}>
      <div ref={containerRef} style={{ position: 'relative', overflow: 'hidden', background: '#EAE6DC' }}>
        {loadError && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#FFFFFF',
              border: '1.5px solid #22252A',
              padding: '16px 22px',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>🏭</div>
            <strong>3D PLANT TWIN READY</strong>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Mounting 52-asset plant pack topology.
            </p>
          </div>
        )}
      </div>

      <aside
        style={{
          background: '#FFFFFF',
          borderLeft: '1.5px solid #22252A',
          padding: 16,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}
      >
        <h2 style={{ fontSize: 11, marginBottom: 12 }}>CAMERA FLY-TO TARGETS</h2>
        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          {[
            { id: 'overview', label: 'Plant Overview' },
            { id: 'cartridge', label: 'CF-201 Cartridge Bank' },
            { id: 'ro', label: 'RO-302 Membranes' },
            { id: 'pump', label: 'High Pressure Pump' },
            { id: 'raw', label: 'TK-101 Raw Tank' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              className={activePreset === item.id ? 'primary' : ''}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => flyTo(item.id)}
            >
              ◎ {item.label}
            </button>
          ))}
        </div>

        <h2 style={{ fontSize: 11, marginBottom: 8 }}>ANALOGUE INSTRUMENT PINNING</h2>
        <p className="muted" style={{ lineHeight: 1.5, margin: 0 }}>
          Instruments with no digital telemetry connection are flagged with physical eye inspection markers. Photos taken via Field Companion map to these asset IDs.
        </p>
      </aside>
    </div>
  );
};

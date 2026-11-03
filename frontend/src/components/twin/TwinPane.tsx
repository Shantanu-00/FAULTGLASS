import React, { useRef, useState } from 'react';
import { useTwinState } from '../../state/useTwinState';
import { CameraPresets } from './CameraPresets';
import { PlantTwin, type PlantTwinHandle } from './PlantTwin';
import { TwinLegend } from './TwinLegend';

const OPERATOR_PRESETS = [
  { id: 'overview', label: 'Overview' },
  { id: 'cartridge', label: 'Cartridge bank' },
  { id: 'gauges', label: 'Front gauges' },
  { id: 'backwash', label: 'Backwash valves' },
  { id: 'ro', label: 'RO skid' },
  { id: 'hp_pump', label: 'HP pump' },
];

export const TwinPane: React.FC = () => {
  const { warningAssets, targets, flaggedTags } = useTwinState();
  const twin = useRef<PlantTwinHandle | null>(null);
  const [preset, setPreset] = useState('overview');

  return (
    <section className="panel twin-pane" aria-label="Digital twin">
      <div className="pane-head">
        <h2 className="panel-title">Digital twin</h2>
        {targets.frame.length > 0 && (
          <button type="button" className="btn btn-small btn-accent" onClick={() => twin.current?.flyToTargets()}>
            Show target
          </button>
        )}
      </div>
      <CameraPresets
        presets={OPERATOR_PRESETS}
        current={preset}
        onPick={(id) => {
          setPreset(id);
          twin.current?.flyTo(id);
        }}
      />
      <div className="twin-frame">
        <PlantTwin ref={twin} targets={targets} warningAssets={warningAssets} />
        <TwinLegend targets={targets} hasFlag={flaggedTags.length > 0} />
      </div>
    </section>
  );
};

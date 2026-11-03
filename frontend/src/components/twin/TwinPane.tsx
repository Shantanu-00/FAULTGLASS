import React, { useEffect, useRef, useState } from 'react';
import { useTwinState } from '../../state/useTwinState';
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
  useEffect(() => setPreset(targets.frame.length ? 'target' : 'overview'), [targets.key]);

  return (
    <section className="panel twin-pane" aria-label="Digital twin">
      <div className="pane-head">
        <h2 className="panel-title">Plant twin</h2>
        <div className="command-twin-controls">
          <select aria-label="Plant camera view" value={preset} onChange={(event) => {
            const id = event.target.value;
            setPreset(id);
            if (id === 'target') twin.current?.flyToTargets();
            else twin.current?.flyTo(id);
          }}>
            {targets.frame.length > 0 && <option value="target">Investigation focus</option>}
            {OPERATOR_PRESETS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
          </select>
          {targets.frame.length > 0 && <button type="button" className="btn btn-small btn-quiet" onClick={() => {
            setPreset('target');
            twin.current?.flyToTargets();
          }}>Show target</button>}
        </div>
      </div>
      <div className="twin-frame">
        <PlantTwin ref={twin} targets={targets} warningAssets={warningAssets} compactFraming />
        <TwinLegend targets={targets} hasFlag={flaggedTags.length > 0} />
      </div>
      <div className="command-twin-caption"><span>{targets.source === 'task' ? 'Highlighted equipment needs field evidence' : targets.source === 'proposal' ? 'Proposed action highlighted' : targets.source === 'focus' ? 'Current investigation focus' : 'Live plant context'}</span><span>Drag to orbit · scroll to zoom</span></div>
    </section>
  );
};

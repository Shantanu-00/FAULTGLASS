import React, { useEffect, useRef, useState } from 'react';
import { useTwinState } from '../../state/useTwinState';
import { PlantTwin, type PlantTwinHandle } from './PlantTwin';
import { TwinLegend } from './TwinLegend';
import { usePlant } from '../../state/PlantContext';

const OPERATOR_PRESETS = [
  { id: 'overview', label: 'Overview' },
  { id: 'cartridge', label: 'Cartridge bank' },
  { id: 'gauges', label: 'Front gauges' },
  { id: 'backwash', label: 'Backwash valves' },
  { id: 'ro', label: 'RO skid' },
  { id: 'hp_pump', label: 'HP pump' },
];

export const TwinPane: React.FC<{ expanded?: boolean; onToggleExpanded?: () => void }> = ({ expanded = false, onToggleExpanded }) => {
  const { plant } = usePlant();
  const { warningAssets, targets, flaggedTags } = useTwinState();
  const twin = useRef<PlantTwinHandle | null>(null);
  const [preset, setPreset] = useState('overview');
  useEffect(() => setPreset(targets.frame.length ? 'target' : 'overview'), [targets.key]);

  return (
    <section className="panel twin-pane" aria-label="Digital twin">
      <div className="pane-head">
        <div><span className="command-eyebrow">Live process / digital twin</span><h2 className="panel-title">{plant?.name || 'Water treatment plant'}</h2></div>
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
          {onToggleExpanded && <button type="button" className="command-tool command-expand-plant" aria-pressed={expanded} onClick={onToggleExpanded}>{expanded ? 'Restore layout' : 'Expand plant'} <span aria-hidden="true">{expanded ? '↙' : '↗'}</span></button>}
        </div>
      </div>
      <div className="twin-frame">
        <PlantTwin ref={twin} targets={targets} warningAssets={warningAssets} compactFraming />
        <TwinLegend targets={targets} hasFlag={flaggedTags.length > 0} />
      </div>
      <div className="command-twin-caption"><span><i aria-hidden="true" />{targets.source === 'task' ? 'Field inspection target highlighted' : targets.source === 'proposal' ? 'Proposed intervention highlighted' : targets.source === 'focus' ? 'Wonder’s current focus highlighted' : 'Plant overview'}</span><span>Drag to orbit · scroll to zoom</span></div>
    </section>
  );
};

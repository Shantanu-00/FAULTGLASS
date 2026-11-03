import React from 'react';

export const PRESETS: Array<{ id: string; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'cartridge', label: 'Cartridge bank' },
  { id: 'gauges', label: 'Front gauges' },
  { id: 'media', label: 'Media filters' },
  { id: 'backwash', label: 'Backwash valves' },
  { id: 'ro', label: 'RO skid' },
  { id: 'hp_pump', label: 'HP pump' },
];

interface Props {
  current: string;
  onPick: (id: string) => void;
  presets?: Array<{ id: string; label: string }>;
}

export const CameraPresets: React.FC<Props> = ({ current, onPick, presets = PRESETS }) => (
  <div className="preset-grid" role="group" aria-label="Camera presets">
    {presets.map((p) => (
      <button key={p.id} type="button" className={`btn btn-small${current === p.id ? ' is-selected' : ''}`} onClick={() => onPick(p.id)}>
        {p.label}
      </button>
    ))}
  </div>
);

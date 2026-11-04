import React, { useEffect, useRef, useState } from 'react';

const ASSETS = {
  inletGauge: { filename: 'inlet_gauge.jpeg', type: 'image/jpeg', label: 'Use demo inlet photo' },
  outletGauge: { filename: 'outlet_gauge.jpeg', type: 'image/jpeg', label: 'Use demo outlet photo' },
  audio: { filename: 'audiofile.mp3', type: 'audio/mpeg', label: 'Use demo audio' },
  lever: { filename: 'valve_closing.mp4', type: 'video/mp4', label: 'Use demo lever video' },
};

interface Props {
  asset: keyof typeof ASSETS;
  onSelect: (file: File) => void;
  disabled?: boolean;
}

/** Load a bundled example into the same capture state as a locally selected file. */
export const DemoAssetButton: React.FC<Props> = ({ asset, onSelect, disabled }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const enabled = useRef(!disabled);
  enabled.current = !disabled;
  const sample = ASSETS[asset];

  useEffect(() => () => controller.current?.abort(), []);

  const load = async () => {
    if (controller.current || disabled) return;
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}demo/${sample.filename}`, { signal: request.signal });
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
        throw new Error('This demo file is unavailable. Please try again or choose your own file.');
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('This demo file is empty. Please choose your own file.');
      if (!request.signal.aborted && enabled.current) {
        onSelect(new File([blob], sample.filename, { type: sample.type }));
      }
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load the demo file. Please try again.');
    } finally {
      if (!request.signal.aborted) {
        controller.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <div className="field-demo-asset">
      <button type="button" className="btn btn-demo" disabled={disabled || loading} aria-busy={loading} onClick={() => void load()}>
        {loading ? <><span className="field-spinner" aria-hidden="true" />Loading demo file…</> : sample.label}
      </button>
      {error && <p className="result-error" role="alert">{error}</p>}
    </div>
  );
};

import React, { useEffect, useId, useState } from 'react';
import { Icon, type IconName } from '../common/Icon';

interface Props {
  kind: 'image' | 'video';
  label: React.ReactNode;
  retakeLabel: React.ReactNode;
  accept: string;
  icon: IconName;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}

export const FileCapture: React.FC<Props> = ({ kind, label, retakeLabel, accept, icon, file, onChange, disabled }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  return (
    <div className={`capture${file ? ' has-file' : ''}`}>
      {url && (
        <figure className="capture-figure">
          {kind === 'image'
            ? <img src={url} alt="Selected gauge photo, ready to submit" className="capture-preview" />
            : <video src={url} controls playsInline preload="metadata" className="capture-preview" aria-label="Selected lever recording" />}
          <figcaption className="capture-name"><strong>{file?.name}</strong><span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : ''} · Ready to submit</span></figcaption>
        </figure>
      )}
      <div className="capture-actions">
        <label htmlFor={inputId} className={`btn btn-xl file-btn${disabled ? ' is-disabled' : ''}`}>
          <Icon name={icon} size={20} />
          {file ? retakeLabel : label}
          <input
            id={inputId}
            type="file"
            accept={accept}
            capture="environment"
            disabled={disabled}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              event.target.value = '';
              if (!selected) return;
              if (!selected.size) {
                setError('This file is empty. Please capture it again.');
                return;
              }
              setError(null);
              onChange(selected);
            }}
          />
        </label>
        {file && <button type="button" className="btn btn-quiet" onClick={() => { onChange(null); setError(null); }} disabled={disabled}>Remove</button>}
      </div>
      {!file && <p className="capture-hint">{kind === 'image' ? 'Use the camera or choose a clear photo.' : 'Use the camera or choose an MP4 or MOV recording.'}</p>}
      {error && <p className="result-error" role="alert">{error}</p>}
    </div>
  );
};

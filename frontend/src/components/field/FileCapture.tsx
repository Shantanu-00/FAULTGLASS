import React, { useEffect, useState } from 'react';
import { Icon, type IconName } from '../common/Icon';

interface Props {
  kind: 'image' | 'video';
  label: string;
  retakeLabel: string;
  accept: string;
  icon: IconName;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}

export const FileCapture: React.FC<Props> = ({ kind, label, retakeLabel, accept, icon, file, onChange, disabled }) => {
  const [url, setUrl] = useState<string | null>(null);

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
    <div className="capture">
      {url && (kind === 'image' ? <img src={url} alt="Selected gauge photo" className="capture-preview" /> : <video src={url} controls playsInline className="capture-preview" />)}
      <label className={`btn btn-xl${file ? '' : ' btn-primary'} file-btn${disabled ? ' is-disabled' : ''}`}>
        <Icon name={icon} size={22} />
        {file ? retakeLabel : label}
        <input type="file" accept={accept} capture="environment" disabled={disabled} onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      </label>
      {file && <p className="muted small capture-name">{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>}
    </div>
  );
};

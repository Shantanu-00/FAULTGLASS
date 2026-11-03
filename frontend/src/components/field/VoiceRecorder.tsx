import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../common/Icon';

interface Props {
  blob: Blob | null;
  onChange: (blob: Blob | null) => void;
  disabled?: boolean;
}

export const VoiceRecorder: React.FC<Props> = ({ blob, onChange, disabled }) => {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const canRecord = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        onChange(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }));
      };
      recorder.current = mr;
      mr.start();
      setRecording(true);
      setSeconds(0);
      timer.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      setError(`Microphone unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const stop = () => {
    recorder.current?.stop();
    setRecording(false);
    if (timer.current) window.clearInterval(timer.current);
  };

  return (
    <div className="recorder">
      <div className="recorder-row">
        {canRecord ? (
          recording ? (
            <button type="button" className="btn btn-xl btn-recording" onClick={stop}>
              <Icon name="stop" size={22} />
              Stop recording ({seconds}s)
            </button>
          ) : (
            <button type="button" className="btn btn-xl" onClick={() => void start()} disabled={disabled}>
              <Icon name="mic" size={22} />
              {blob ? 'Record again' : 'Record voice note'}
            </button>
          )
        ) : (
          <label className="btn btn-xl file-btn">
            <Icon name="mic" size={22} />
            {blob ? 'Replace voice note' : 'Record voice note'}
            <input
              type="file"
              accept="audio/*"
              capture="user"
              onChange={(e) => onChange(e.target.files?.[0] ?? null)}
              disabled={disabled}
            />
          </label>
        )}
        {blob && !recording && (
          <button type="button" className="btn btn-quiet" onClick={() => onChange(null)} disabled={disabled}>
            Discard
          </button>
        )}
      </div>
      {!canRecord && <p className="muted small">In-page recording needs HTTPS. This button opens the phone's own recorder instead.</p>}
      {url && !recording && <audio controls src={url} className="audio-preview" />}
      {error && <p className="result-error" role="alert">{error}</p>}
      <p className="muted small">Speak the gauge tag and value, in Marathi or English. The note is converted to WAV before upload.</p>
    </div>
  );
};

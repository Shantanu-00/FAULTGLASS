import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../common/Icon';
import { DemoAssetButton } from './DemoAssetButton';

interface Props {
  blob: Blob | null;
  onChange: (blob: Blob | null) => void;
  disabled?: boolean;
  onRecordingChange?: (recording: boolean) => void;
}

export const VoiceRecorder: React.FC<Props> = ({ blob, onChange, disabled, onRecordingChange }) => {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);
  const opening = useRef(false);
  const onChangeRef = useRef(onChange);
  const onRecordingRef = useRef(onRecordingChange);
  onChangeRef.current = onChange;
  onRecordingRef.current = onRecordingChange;
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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) window.clearInterval(timer.current);
      const current = recorder.current;
      if (current && current.state !== 'inactive') current.stop();
      current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const stop = () => {
    const current = recorder.current;
    if (current && current.state !== 'inactive') current.stop();
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  };

  const start = async () => {
    if (opening.current || disabled || recorder.current?.state === 'recording') return;
    opening.current = true;
    setRequesting(true);
    onRecordingRef.current?.(true);
    setError(null);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const chunks: Blob[] = [];
      const current = new MediaRecorder(stream);
      current.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      current.onstop = () => {
        if (timer.current !== null) window.clearInterval(timer.current);
        timer.current = null;
        current.stream.getTracks().forEach((track) => track.stop());
        if (!mounted.current) return;
        const next = new Blob(chunks, { type: current.mimeType || 'audio/webm' });
        if (next.size) onChangeRef.current(next);
        else setError('No audio was captured. Please record again or choose an audio file.');
        setRecording(false);
        onRecordingRef.current?.(false);
      };
      current.onerror = () => {
        if (timer.current !== null) window.clearInterval(timer.current);
        timer.current = null;
        current.stream.getTracks().forEach((track) => track.stop());
        if (mounted.current) {
          setRecording(false);
          setError('Recording stopped unexpectedly. Please try again.');
          onRecordingRef.current?.(false);
        }
      };
      recorder.current = current;
      current.start();
      setRecording(true);
      setSeconds(0);
      timer.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch (e) {
      stream?.getTracks().forEach((track) => track.stop());
      if (mounted.current) {
        setError(`Microphone unavailable. ${e instanceof Error ? e.message : 'Check permission and try again.'}`);
        onRecordingRef.current?.(false);
      }
    } finally {
      opening.current = false;
      if (mounted.current) setRequesting(false);
    }
  };

  const locked = disabled || recording || requesting;

  return (
    <section className={`recorder${recording ? ' is-recording' : ''}`} aria-label="Voice note">
      <div className="recorder-head"><strong>Voice note <span>Optional</span></strong>{recording && <span className="recording-status" role="status">Recording · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}</div>
      <p className="hint-text">Describe what you see in your own words. Review the recording before sending.</p>
      <div className="recorder-row">
        {canRecord && (recording ? (
          <button type="button" className="btn btn-xl btn-recording" onClick={stop}><Icon name="stop" size={20} />Stop recording</button>
        ) : (
          <button type="button" className="btn btn-xl" onClick={() => void start()} disabled={disabled || requesting} aria-busy={requesting}>
            <Icon name="mic" size={20} />{requesting ? 'Allow microphone access…' : blob ? 'Record again' : 'Record voice note'}
          </button>
        ))}
        <label className={`btn file-btn${locked ? ' is-disabled' : ''}`}>
          {blob ? 'Replace audio' : 'Choose audio'}
          <input type="file" accept="audio/*" capture="user" disabled={locked} onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            if (!file.size) { setError('This audio file is empty. Please choose another.'); return; }
            setError(null);
            onChange(file);
          }} />
        </label>
        {blob && !recording && <button type="button" className="btn btn-quiet" onClick={() => onChange(null)} disabled={disabled || requesting}>Discard</button>}
      </div>
      <DemoAssetButton asset="audio" onSelect={(file) => { setError(null); onChange(file); }} disabled={locked} />
      {!canRecord && <p className="muted small">Microphone recording is unavailable here. Choose an audio file to continue.</p>}
      {url && !recording && <audio controls preload="metadata" src={url} className="audio-preview" aria-label="Review your voice note" />}
      {error && <p className="result-error" role="alert">{error}</p>}
    </section>
  );
};

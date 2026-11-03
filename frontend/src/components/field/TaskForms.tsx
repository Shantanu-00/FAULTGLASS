import React, { useState } from 'react';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/format';
import { encodeWavBase64, fileToBase64, prepareImage, videoDuration } from '../../lib/media';
import { usePlant } from '../../state/PlantContext';
import type { FieldTask, PhotoResponse, VideoResponse } from '../../types';
import { Bi } from '../common/Bi';
import { Icon } from '../common/Icon';
import { FileCapture } from './FileCapture';
import { Pill } from '../common/Pill';
import { DifferentialResult, GaugeResults, PolicyResult, VoiceResult } from './Results';
import { VoiceRecorder } from './VoiceRecorder';

interface FormProps {
  incidentId: string;
  task: FieldTask;
}

const GAUGE_ROLES: Record<string, string> = { 'PI-201': 'Inlet gauge', 'PI-202': 'Outlet gauge' };

export const GaugePhotoForm: React.FC<FormProps> = ({ incidentId, task }) => {
  const { refreshIncident, notify } = usePlant();
  const [photos, setPhotos] = useState<Record<string, File | null>>({});
  const [accepted, setAccepted] = useState<Record<string, number>>(task.result?.accepted ?? {});
  const [voice, setVoice] = useState<Blob | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<PhotoResponse | null>(null);

  const chosen = task.tags.filter((tag) => photos[tag]);
  const ready = chosen.length > 0 && task.tags.every((tag) => photos[tag] || accepted[tag] !== undefined);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const encoded: Record<string, string> = {};
      for (const tag of chosen) encoded[tag] = await fileToBase64(await prepareImage(photos[tag] as File));
      const audio = voice ? await encodeWavBase64(voice) : null;
      const response = await api.completeTaskPhoto(incidentId, task.id, encoded, note, audio);
      setAttempt(response);
      setAccepted(response.accepted ?? {});
      setPhotos((current) => {
        const next = { ...current };
        for (const tag of Object.keys(response.accepted ?? {})) next[tag] = null;
        return next;
      });
      if (response.completed) {
        notify('Gauge evidence stored. The investigation has resumed.');
        await refreshIncident();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="task-form">
      <p className="hint-text">Take one photo of the inlet gauge and one of the outlet gauge. Stand square-on so the dial face and needle are sharp.</p>
      {task.tags.map((tag) => (
        <section className="gauge-box" key={tag} aria-label={`${GAUGE_ROLES[tag] ?? 'Gauge'} ${tag}`}>
          <h4>
            {GAUGE_ROLES[tag] ?? 'Gauge'} <code className="tag">{tag}</code>
          </h4>
          {accepted[tag] !== undefined && !photos[tag] && (
            <p className="gauge-read">
              <Pill tone="ok">Read</Pill> <strong>{accepted[tag].toFixed(1)} psi</strong>
            </p>
          )}
          <FileCapture
            kind="image"
            label={<Bi stack en={`Take ${(GAUGE_ROLES[tag] ?? 'gauge').toLowerCase()} photo`} mr="गेजचा फोटो घ्या" />}
            retakeLabel="Retake photo"
            accept="image/*"
            icon="camera"
            file={photos[tag] ?? null}
            onChange={(file) => setPhotos({ ...photos, [tag]: file })}
            disabled={busy}
          />
        </section>
      ))}
      <VoiceRecorder blob={voice} onChange={setVoice} disabled={busy} />
      <label className="form-field">
        <span>
          <Bi en="Note (optional)" mr="टीप" />
        </span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} disabled={busy} />
      </label>
      <button type="button" className="btn btn-xl btn-primary" disabled={!ready || busy} onClick={() => void submit()}>
        <Icon name="send" size={20} />
        {busy ? 'Analysing, please wait' : <Bi stack en="Send for reading" mr="फोटो पाठवा" />}
      </button>
      {busy && <p className="muted" role="status">The photos are being analysed on the server. This can take up to a minute.</p>}
      {error && <p className="result-error" role="alert">{error}</p>}
      {attempt && (
        <div className={`attempt${attempt.completed ? ' is-ok' : ' is-retry'}`} role="status">
          <strong>{attempt.completed ? 'Both gauges read' : 'Not complete yet'}</strong>
          {attempt.reason && <p>{attempt.reason}</p>}
          <GaugeResults gauges={attempt.readings} />
          {attempt.differential && <DifferentialResult differential={attempt.differential} />}
          {attempt.voice && <VoiceResult voice={attempt.voice} />}
        </div>
      )}
    </div>
  );
};

const STAGES = [
  { angle: '0 degrees', name: 'Open', hint: 'Lever parallel to the pipe. Hold 1 s.' },
  { angle: '45 degrees', name: 'Half', hint: 'Hold for at least 2 s.', mr: 'किमान 2 sec' },
  { angle: '90 degrees', name: 'Closed', hint: 'Lever perpendicular to the pipe.' },
];

export const ValveForm: React.FC<FormProps> = ({ incidentId, task }) => {
  const { refreshIncident, notify } = usePlant();
  const [clip, setClip] = useState<File | null>(null);
  const [fps, setFps] = useState('30');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<VideoResponse | null>(null);

  const unsupported = clip && !['video/mp4', 'video/quicktime'].includes(clip.type);

  const submit = async () => {
    if (!clip || unsupported) return;
    setBusy(true);
    setError(null);
    try {
      const duration = await videoDuration(clip);
      const response = await api.completeTaskVideo(incidentId, task.id, await fileToBase64(clip), clip.type, Number(fps) || null, duration, note);
      setAttempt(response);
      if (response.completed) {
        notify('Lever action verified. The verifier is now watching telemetry.');
        await refreshIncident();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="task-form">
      <ol className="stage-guide">
        {STAGES.map((s) => (
          <li key={s.angle}>
            <strong>{s.angle}</strong>
            <span>{s.name}</span>
            <small>{s.hint}</small>
            {s.mr && (
              <small lang="mr">{s.mr}</small>
            )}
          </li>
        ))}
      </ol>
      <p className="hint-text">Record one continuous take. Keep the lever and a straight run of pipe in frame the whole time.</p>
      <FileCapture kind="video" label={<Bi stack en="Record lever clip" mr="लीव्हर क्लिप" />} retakeLabel="Record again" accept="video/mp4,video/quicktime" icon="video" file={clip} onChange={setClip} disabled={busy} />
      {unsupported && (
        <p className="result-error" role="alert">
          This clip is {clip?.type || 'an unknown format'}. Only MP4 or MOV is accepted. Record again with the phone's own camera.
        </p>
      )}
      <label className="form-field">
        <span>Frames per second</span>
        <input type="number" inputMode="numeric" min={1} max={240} value={fps} onChange={(e) => setFps(e.target.value)} disabled={busy} />
      </label>
      <label className="form-field">
        <span>
          <Bi en="Note (optional)" mr="टीप" />
        </span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} disabled={busy} />
      </label>
      <button type="button" className="btn btn-xl btn-primary" disabled={!clip || Boolean(unsupported) || busy} onClick={() => void submit()}>
        <Icon name="send" size={20} />
        {busy ? 'Analysing, please wait' : <Bi stack en="Send clip" mr="क्लिप पाठवा" />}
      </button>
      {busy && <p className="muted" role="status">The clip is being uploaded and tracked on the server. This can take a few minutes.</p>}
      {error && <p className="result-error" role="alert">{error}</p>}
      {attempt && (
        <div className={`attempt${attempt.completed ? ' is-ok' : ' is-retry'}`} role="status">
          <strong>{attempt.completed ? 'Staged action verified' : 'Action not verified'}</strong>
          {attempt.reason && <p>{attempt.reason}</p>}
          <PolicyResult policy={attempt.policy} />
        </div>
      )}
    </div>
  );
};

export const ObservationForm: React.FC<FormProps> = ({ incidentId, task }) => {
  const { refreshIncident, notify } = usePlant();
  const [values, setValues] = useState<Record<string, string>>({});
  const [voice, setVoice] = useState<Blob | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceResult, setVoiceResult] = useState<Awaited<ReturnType<typeof api.submitTaskVoice>>['voice'] | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const sendVoice = () =>
    guard(async () => {
      if (!voice) return;
      const out = await api.submitTaskVoice(incidentId, task.id, await encodeWavBase64(voice));
      setVoiceResult(out.voice);
    });

  const submit = () =>
    guard(async () => {
      const readings: Record<string, number> = {};
      for (const [tag, text] of Object.entries(values)) if (text !== '') readings[tag] = Number(text);
      await api.completeTask(incidentId, task.id, readings, note);
      notify('Observation sent. The investigation has resumed.');
      await refreshIncident();
    });

  return (
    <div className="task-form">
      {task.tags.map((tag) => (
        <label className="form-field" key={tag}>
          <span>
            <code className="tag">{tag}</code> reading (psi)
          </span>
          <input type="number" inputMode="decimal" step="any" value={values[tag] ?? ''} onChange={(e) => setValues({ ...values, [tag]: e.target.value })} disabled={busy} />
        </label>
      ))}
      <label className="form-field">
        <span>
          <Bi en="What did you see?" mr="तुम्हाला काय दिसले?" />
        </span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} disabled={busy} />
      </label>
      <VoiceRecorder blob={voice} onChange={setVoice} disabled={busy} />
      {voice && (
        <button type="button" className="btn btn-xl" disabled={busy} onClick={() => void sendVoice()}>
          <Bi stack en="Send voice note only" mr="फक्त आवाज पाठवा" />
        </button>
      )}
      {voiceResult && <VoiceResult voice={voiceResult} />}
      <button type="button" className="btn btn-xl btn-primary" disabled={busy} onClick={() => void submit()}>
        <Icon name="send" size={20} />
        Submit observation
      </button>
      {error && <p className="result-error" role="alert">{error}</p>}
    </div>
  );
};

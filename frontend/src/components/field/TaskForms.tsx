import React, { useRef, useState } from 'react';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/format';
import { encodeWavBase64, fileToBase64, prepareImage, videoDuration } from '../../lib/media';
import { usePlant } from '../../state/PlantContext';
import type { FieldTask, PhotoResponse, VideoResponse } from '../../types';
import { Icon } from '../common/Icon';
import { DemoAssetButton } from './DemoAssetButton';
import { FileCapture } from './FileCapture';
import { Pill } from '../common/Pill';
import { DifferentialResult, GaugeResults, PolicyResult, VoiceResult } from './Results';
import { VoiceRecorder } from './VoiceRecorder';

interface FormProps {
  incidentId: string;
  task: FieldTask;
}

const GAUGE_ROLES: Record<string, string> = { 'PI-201': 'Inlet gauge', 'PI-202': 'Outlet gauge' };

function useSubmission() {
  const { connection } = usePlant();
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const lock = useRef(false);
  const online = connection === 'online';
  const run = async (job: (progress: (message: string) => void) => Promise<boolean | void>) => {
    if (lock.current || completed) return;
    if (!online) { setError('Reconnect to submit. Your selected files and notes are still here.'); return; }
    lock.current = true;
    setError(null);
    setPhase('Preparing your evidence…');
    try {
      if (await job(setPhase)) setCompleted(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setPhase(null);
    }
  };
  return { phase, error, completed, online, busy: phase !== null, run };
}

type Submission = ReturnType<typeof useSubmission>;
const SubmissionStatus: React.FC<{ state: Submission }> = ({ state }) => (
  <div className="field-submit-status" aria-live="polite">
    {state.phase && <p className="field-progress" role="status"><span className="field-spinner" aria-hidden="true" />{state.phase}</p>}
    {!state.online && <p className="field-offline">You are offline. You can prepare evidence now and submit after reconnecting.</p>}
    {state.error && <div className="field-error" role="alert"><strong>Could not submit evidence</strong><p>{state.error}</p><p>Your files are kept here. Review them and try again.</p></div>}
    {state.completed && <p className="field-success" role="status"><Icon name="check" size={18} />Evidence submitted. The investigation will continue.</p>}
  </div>
);

export const GaugePhotoForm: React.FC<FormProps> = ({ incidentId, task }) => {
  const { refreshIncident, notify } = usePlant();
  const [photos, setPhotos] = useState<Record<string, File | null>>({});
  const [accepted, setAccepted] = useState<Record<string, number>>(task.result?.accepted ?? {});
  const [voice, setVoice] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState('');
  const [attempt, setAttempt] = useState<PhotoResponse | null>(null);
  const state = useSubmission();
  const locked = state.busy || state.completed;
  const chosen = task.tags.filter((tag) => photos[tag]);
  const ready = chosen.length > 0 && task.tags.every((tag) => photos[tag] || accepted[tag] !== undefined);
  const captured = task.tags.filter((tag) => photos[tag] || accepted[tag] !== undefined).length;

  const submit = () => state.run(async (progress) => {
    if (!ready || recording) return;
    const encoded: Record<string, string> = {};
    for (const tag of chosen) {
      progress(`Preparing ${GAUGE_ROLES[tag]?.toLowerCase() ?? tag} photo…`);
      encoded[tag] = await fileToBase64(await prepareImage(photos[tag] as File));
    }
    progress(voice ? 'Preparing photos and voice note…' : 'Preparing photos…');
    const audio = voice ? await encodeWavBase64(voice) : null;
    progress('Uploading and reading the gauges. This may take a minute…');
    const response = await api.completeTaskPhoto(incidentId, task.id, encoded, note, audio);
    setAttempt(response);
    setAccepted((current) => ({ ...current, ...response.accepted }));
    setPhotos((current) => {
      const next = { ...current };
      for (const tag of Object.keys(response.accepted ?? {})) next[tag] = null;
      return next;
    });
    if (response.completed) {
      notify('Gauge evidence stored. The investigation has resumed.');
      await refreshIncident();
    }
    return response.completed;
  });

  return (
    <div className="task-form" aria-busy={state.busy}>
      <div className="field-form-intro"><strong>Capture the readings</strong><span>{captured} of {task.tags.length} ready</span></div>
      <p className="hint-text">Photograph each requested gauge straight on. Keep the entire dial, needle and scale sharp and visible.</p>
      <div className="gauge-capture-grid">
        {task.tags.map((tag, index) => (
          <section className="gauge-box" key={tag} aria-label={`${GAUGE_ROLES[tag] ?? 'Gauge'} ${tag}`}>
            <div className="gauge-box-head"><span className="field-step-number">{index + 1}</span><h3>{GAUGE_ROLES[tag] ?? 'Gauge'} <code className="tag">{tag}</code></h3></div>
            {accepted[tag] !== undefined && !photos[tag] && <p className="gauge-read"><Pill tone="ok">Accepted</Pill><strong>{accepted[tag].toFixed(1)} psi</strong></p>}
            <FileCapture kind="image" label={`Capture ${(GAUGE_ROLES[tag] ?? 'gauge').toLowerCase()}`} retakeLabel="Replace photo" accept="image/*" icon="camera" file={photos[tag] ?? null} onChange={(file) => setPhotos((current) => ({ ...current, [tag]: file }))} disabled={locked} />
            {(tag === 'PI-201' || tag === 'PI-202') && <DemoAssetButton asset={tag === 'PI-201' ? 'inletGauge' : 'outletGauge'} onSelect={(file) => setPhotos((current) => ({ ...current, [tag]: file }))} disabled={locked} />}
          </section>
        ))}
      </div>
      <VoiceRecorder blob={voice} onChange={setVoice} disabled={locked} onRecordingChange={setRecording} />
      <label className="form-field"><span>Additional note <small>Optional</small></span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={1000} placeholder="Anything the investigator should know?" disabled={locked} /></label>
      <SubmissionStatus state={state} />
      <button type="button" className="btn btn-xl btn-primary field-submit" disabled={!ready || locked || recording || !state.online} onClick={() => void submit()}>
        <Icon name={state.completed ? 'check' : 'send'} size={20} />{state.completed ? 'Evidence submitted' : state.busy ? 'Checking gauge evidence…' : state.error ? 'Retry gauge submission' : 'Submit gauge evidence'}
      </button>
      {!ready && !locked && <p className="capture-hint">Add a photo for each gauge to continue. Accepted readings do not need another photo.</p>}
      {recording && <p className="capture-hint">Stop the voice recording before submitting.</p>}
      {attempt && <div className={`attempt${attempt.completed ? ' is-ok' : ' is-retry'}`} role="status"><strong>{attempt.completed ? 'Gauge readings accepted' : 'Review the requested retake'}</strong>{attempt.reason && <p>{attempt.reason}</p>}<GaugeResults gauges={attempt.readings} />{attempt.differential && <DifferentialResult differential={attempt.differential} />}{attempt.voice && <VoiceResult voice={attempt.voice} />}</div>}
    </div>
  );
};

const STAGES = [
  { angle: '0°', name: 'Start open', hint: 'Lever parallel to the pipe. Hold for 1 second.' },
  { angle: '45°', name: 'Pause halfway', hint: 'Hold for at least 2 seconds before continuing.' },
  { angle: '90°', name: 'Finish closed', hint: 'Lever across the pipe. Stop the recording here.' },
];

export const ValveForm: React.FC<FormProps> = ({ incidentId, task }) => {
  const { refreshIncident, notify } = usePlant();
  const [clip, setClip] = useState<File | null>(null);
  const [fps, setFps] = useState('');
  const [note, setNote] = useState('');
  const [attempt, setAttempt] = useState<VideoResponse | null>(null);
  const state = useSubmission();
  const locked = state.busy || state.completed;
  const mime = clip?.type || (clip?.name.toLowerCase().endsWith('.mov') ? 'video/quicktime' : clip?.name.toLowerCase().endsWith('.mp4') ? 'video/mp4' : '');
  const unsupported = Boolean(clip && !['video/mp4', 'video/quicktime'].includes(mime));
  const invalidFps = fps !== '' && (!Number.isInteger(Number(fps)) || Number(fps) < 1 || Number(fps) > 240);

  const submit = () => state.run(async (progress) => {
    if (!clip || unsupported || invalidFps) return;
    progress('Preparing the lever recording…');
    const duration = await videoDuration(clip);
    const video = await fileToBase64(clip);
    progress('Uploading and tracking the staged movement. This may take a few minutes…');
    const response = await api.completeTaskVideo(incidentId, task.id, video, mime, fps ? Number(fps) : null, duration, note);
    setAttempt(response);
    if (response.completed) {
      notify('Lever action verified. The verifier is now watching telemetry.');
      await refreshIncident();
    }
    return response.completed;
  });

  return (
    <div className="task-form" aria-busy={state.busy}>
      <div className="field-form-intro"><strong>Record the staged action</strong><span>One continuous take</span></div>
      <ol className="stage-guide">{STAGES.map((stage, index) => <li key={stage.angle}><span className="field-step-number">{index + 1}</span><strong>{stage.name} <span>{stage.angle}</span></strong><small>{stage.hint}</small></li>)}</ol>
      <p className="hint-text">Keep the lever, your hand and a straight section of pipe visible throughout the recording. Follow the approved work instruction above.</p>
      <FileCapture kind="video" label="Record or select lever video" retakeLabel="Replace recording" accept="video/mp4,video/quicktime,.mp4,.mov" icon="video" file={clip} onChange={setClip} disabled={locked} />
      <DemoAssetButton asset="lever" onSelect={setClip} disabled={locked} />
      {unsupported && <p className="result-error" role="alert">This file format is not supported. Choose an MP4 or MOV recorded with your camera.</p>}
      <details className="field-advanced"><summary>Recording details <span>Optional</span></summary><label className="form-field"><span>Frames per second</span><input type="number" inputMode="numeric" min={1} max={240} value={fps} onChange={(event) => setFps(event.target.value)} placeholder="Detect automatically" disabled={locked} aria-invalid={invalidFps} /></label>{invalidFps && <p className="result-error">Enter a whole number from 1 to 240, or leave this blank.</p>}</details>
      <label className="form-field"><span>Additional note <small>Optional</small></span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={1000} placeholder="Add any relevant detail about the action." disabled={locked} /></label>
      <SubmissionStatus state={state} />
      <button type="button" className="btn btn-xl btn-primary field-submit" disabled={!clip || unsupported || invalidFps || locked || !state.online} onClick={() => void submit()}><Icon name={state.completed ? 'check' : 'send'} size={20} />{state.completed ? 'Recording submitted' : state.busy ? 'Verifying the movement…' : state.error ? 'Retry recording submission' : 'Submit for verification'}</button>
      {attempt && <div className={`attempt${attempt.completed ? ' is-ok' : ' is-retry'}`} role="status"><strong>{attempt.completed ? 'Staged action verified' : 'Movement needs review'}</strong>{attempt.reason && <p>{attempt.reason}</p>}<PolicyResult policy={attempt.policy} /></div>}
    </div>
  );
};

export const ObservationForm: React.FC<FormProps> = ({ incidentId, task }) => {
  const { refreshIncident, notify } = usePlant();
  const [values, setValues] = useState<Record<string, string>>({});
  const [voice, setVoice] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState('');
  const [voiceResult, setVoiceResult] = useState<Awaited<ReturnType<typeof api.submitTaskVoice>>['voice'] | null>(null);
  const savedVoice = useRef<Blob | null>(null);
  const state = useSubmission();
  const locked = state.busy || state.completed;
  const hasContent = Boolean(note.trim() || voice || Object.values(values).some((value) => value !== '' && Number.isFinite(Number(value))));
  const invalidReading = Object.values(values).some((value) => value !== '' && !Number.isFinite(Number(value)));

  const storeVoice = async (progress: (message: string) => void) => {
    if (!voice || voice === savedVoice.current) return;
    progress('Preparing the voice note…');
    const audio = await encodeWavBase64(voice);
    progress('Uploading and transcribing the voice note…');
    const out = await api.submitTaskVoice(incidentId, task.id, audio);
    setVoiceResult(out.voice);
    if (!out.recorded || out.voice.error) throw new Error(out.voice.error || 'The voice note could not be saved. Try again.');
    savedVoice.current = voice;
  };
  const sendVoice = () => state.run(async (progress) => { if (recording) return; await storeVoice(progress); notify('Voice note saved with this field task.'); });
  const submit = () => state.run(async (progress) => {
    if (!hasContent || invalidReading || recording) return;
    await storeVoice(progress);
    const readings: Record<string, number> = {};
    for (const [tag, text] of Object.entries(values)) if (text !== '') readings[tag] = Number(text);
    progress('Submitting the field observation…');
    const response = await api.completeTask(incidentId, task.id, readings, note);
    if (!response.completed) throw new Error('The observation was not accepted. Review the requested readings and try again.');
    notify('Observation sent. The investigation has resumed.');
    await refreshIncident();
    return true;
  });

  return (
    <div className="task-form" aria-busy={state.busy}>
      <div className="field-form-intro"><strong>Share what you found</strong><span>Readings, note or audio</span></div>
      {task.tags.length > 0 && <div className="field-reading-grid">{task.tags.map((tag) => <label className="form-field" key={tag}><span><code className="tag">{tag}</code> reading · psi</span><input type="number" inputMode="decimal" step="any" value={values[tag] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [tag]: event.target.value }))} disabled={locked} placeholder="Enter reading" /></label>)}</div>}
      <label className="form-field"><span>What did you observe?</span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} placeholder="Describe the condition, location and any unusual signs." disabled={locked} /></label>
      <VoiceRecorder blob={voice} onChange={(next) => { setVoice(next); setVoiceResult(null); savedVoice.current = null; }} disabled={locked} onRecordingChange={setRecording} />
      {voice && <button type="button" className="btn field-voice-check" disabled={locked || recording || !state.online || voice === savedVoice.current} onClick={() => void sendVoice()}>{voice === savedVoice.current ? 'Voice note saved' : 'Transcribe voice note'}</button>}
      {voiceResult && <VoiceResult voice={voiceResult} />}
      <SubmissionStatus state={state} />
      <button type="button" className="btn btn-xl btn-primary field-submit" disabled={!hasContent || invalidReading || locked || recording || !state.online} onClick={() => void submit()}><Icon name={state.completed ? 'check' : 'send'} size={20} />{state.completed ? 'Observation submitted' : state.busy ? 'Saving the observation…' : state.error ? 'Retry observation' : 'Submit observation'}</button>
      {!hasContent && <p className="capture-hint">Add a reading, written note or voice note to continue.</p>}
      {recording && <p className="capture-hint">Stop the voice recording before submitting.</p>}
    </div>
  );
};

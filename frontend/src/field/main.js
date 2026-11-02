import { api } from '../console/api.js';
import { encodeWavBase64, fileToBase64 } from './audio.js';

const el = (id) => document.getElementById(id);
let detail = null;
let toastTimer;

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

function toast(message) {
  const node = el('toast');
  node.textContent = message;
  node.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('on'), 4500);
}

function taskTitle(task) {
  if (task.kind === 'gauge_photo') return 'Photograph the gauges · गेजचा फोटो घ्या';
  if (task.kind === 'valve_action') return 'Turn V-113 in stages · झडप टप्प्याटप्पाने फिरवा';
  return 'Field observation · निरीक्षण';
}

function render() {
  const root = el('tasks');
  const done = el('completed');
  if (!detail) {
    el('incident-title').textContent = 'No live field task';
    el('incident-meta').textContent = 'When Wonder needs physical evidence, it will appear here.';
    root.replaceChildren(h('p', { class: 'muted' }, 'No pending work. Keep this page open.'));
    done.replaceChildren(h('p', { class: 'muted' }, 'Nothing submitted yet.'));
    return;
  }
  el('incident-title').textContent = detail.incident.title;
  el('incident-meta').textContent = `${detail.incident.incident_id} · Investigation: ${detail.investigation.status.replace('_', ' ')}`;
  const pending = detail.field_tasks.filter((task) => task.status === 'pending');
  const completed = detail.field_tasks.filter((task) => task.status === 'completed');
  root.replaceChildren(...(pending.length ? pending.map(renderTask) : [
    h('section', { class: 'task' }, h('h2', {}, 'Waiting for the next instruction'), h('p', { class: 'muted' }, 'The investigator or commander has not sent a new physical task.')),
  ]));
  done.replaceChildren(...(completed.length ? completed.map((task) => {
    const result = task.result || {};
    const voice = result.voice?.comparison?.status;
    const policy = result.policy?.status;
    return h('div', { class: 'completed-item' },
      h('strong', {}, taskTitle(task)), document.createTextNode(` — ${task.status}`),
      h('div', { class: 'muted' }, [voice ? `Voice: ${voice}` : '', policy ? `Valve policy: ${policy}` : '']
        .filter(Boolean).join(' · ') || 'Evidence stored.'));
  }) : [h('p', { class: 'muted' }, 'Nothing submitted yet.')]));
}

function renderTask(task) {
  const card = h('section', { class: `task ${task.kind}` });
  card.append(
    h('div', { class: 'task-head' }, h('h2', {}, taskTitle(task)), h('span', { class: 'badge' }, task.status)),
    h('p', { class: 'instruction' }, task.instruction),
    h('div', { class: 'codes' }, [...(task.asset_ids || []), ...(task.tags || [])].map((code) => h('code', {}, code))),
  );
  if (task.kind === 'gauge_photo') card.append(gaugeForm(task));
  else if (task.kind === 'valve_action') card.append(valveForm(task));
  else card.append(observationForm(task));
  return card;
}

function gaugeForm(task) {
  const photo = h('input', { type: 'file', accept: 'image/*', capture: 'environment' });
  const note = h('textarea', { placeholder: 'Operator note · ऑपरेटरची टीप' });
  const result = h('div', { class: 'result' }, 'Take one square-on photo with every requested dial and needle visible.');
  const recorder = voiceRecorder();
  const submit = h('button', { type: 'button' }, 'Submit photo · फोटो पाठवा');
  submit.addEventListener('click', async () => {
    if (!photo.files?.length) { toast('Choose a gauge photo first'); return; }
    submit.disabled = true;
    result.textContent = 'SAM is masking the dials and Wonder is reading them…';
    try {
      const audio = recorder.blob ? await encodeWavBase64(recorder.blob) : null;
      const out = await api.completeTaskPhoto(
        detail.incident.incident_id, task.id, await fileToBase64(photo.files[0]), note.value, audio);
      result.textContent = out.completed
        ? `Stored: ${out.readings.map((r) => `${r.tag} ${r.value ?? '—'} psi (${r.status})`).join(', ')}${out.voice ? `\nVoice: ${out.voice.comparison?.status || 'recorded'} — ${out.voice.transcript || ''}` : ''}`
        : out.reason || 'No confident reading. Move closer and re-shoot.';
      if (out.completed) { toast('Gauge evidence sent'); await refresh(); }
    } catch (error) {
      result.textContent = error.message;
    } finally { submit.disabled = false; }
  });
  return h('div', {},
    h('label', {}, 'Gauge photo · गेज फोटो', photo),
    recorder.node,
    h('label', {}, 'Note · टीप', note),
    submit,
    result,
  );
}

function voiceRecorder() {
  let mediaRecorder = null;
  let chunks = [];
  const state = { blob: null };
  const status = h('span', { class: 'muted' }, 'No voice note recorded.');
  const start = h('button', { type: 'button', class: 'secondary' }, 'Record voice · आवाज नोंदवा');
  const stop = h('button', { type: 'button', class: 'danger', disabled: true }, 'Stop · थांबवा');
  start.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      mediaRecorder.onstop = () => {
        state.blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        status.textContent = 'Voice note ready. It will be converted to WAV and transcribed in Marathi/English.';
      };
      mediaRecorder.start();
      start.disabled = true; stop.disabled = false;
      status.textContent = 'Recording… say the gauge tag and value clearly.';
    } catch (error) {
      status.textContent = `Microphone unavailable: ${error.message}`;
    }
  });
  stop.addEventListener('click', () => {
    mediaRecorder?.stop();
    start.disabled = false; stop.disabled = true;
  });
  state.node = h('div', {}, h('div', { class: 'actions' }, start, stop), status);
  return state;
}

function valveForm(task) {
  const video = h('input', { type: 'file', accept: 'video/mp4,video/quicktime', capture: 'environment' });
  const fps = h('input', { type: 'number', min: '1', max: '240', step: '1', value: '30' });
  const note = h('textarea', { placeholder: 'Operator note · ऑपरेटरची टीप' });
  const result = h('div', { class: 'result' }, 'SAM will track the lever and pipe. The simulator action is triggered only if code sees OPEN → MID hold → CLOSED.');
  const submit = h('button', { type: 'button' }, 'Submit lever clip · क्लिप पाठवा');
  submit.addEventListener('click', async () => {
    if (!video.files?.length) { toast('Choose the lever clip first'); return; }
    const file = video.files[0];
    if (!['video/mp4', 'video/quicktime'].includes(file.type)) {
      result.textContent = `This clip is ${file.type || 'an unknown format'}. SAM requires MP4 or MOV; please re-record/export in one of those formats.`;
      return;
    }
    submit.disabled = true;
    result.textContent = 'Uploading the clip to SAM and measuring the lever angle…';
    try {
      const duration = await videoDuration(file);
      const out = await api.completeTaskVideo(
        detail.incident.incident_id, task.id, await fileToBase64(file), file.type,
        Number(fps.value) || null, duration, note.value);
      result.textContent = out.completed
        ? `Passed: ${out.policy.stages_seen.join(' → ')}. Simulator backwash acknowledged; the verifier is now watching telemetry.`
        : `${out.reason}\nPolicy: ${out.policy.status} — ${out.policy.reasons.join(' ')}`;
      if (out.completed) { toast('Verified lever action sent'); await refresh(); }
    } catch (error) {
      result.textContent = error.message;
    } finally { submit.disabled = false; }
  });
  return h('div', {},
    h('div', { class: 'stage-guide' },
      h('div', {}, h('strong', {}, '0°'), 'OPEN · pipe-parallel'),
      h('div', {}, h('strong', {}, '45°'), 'HOLD · किमान 2 sec'),
      h('div', {}, h('strong', {}, '90°'), 'CLOSED · perpendicular')),
    h('label', {}, 'Lever clip (MP4/MOV) · लीव्हर क्लिप', video),
    h('label', {}, 'Frames per second', fps),
    h('label', {}, 'Note · टीप', note),
    submit,
    result,
  );
}

function videoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(probe.duration) ? probe.duration : null); };
    probe.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    probe.src = url;
  });
}

function observationForm(task) {
  const note = h('textarea', { placeholder: 'What did you see? · तुम्हाला काय दिसले?' });
  const inputs = new Map();
  const form = h('div', {});
  for (const tag of task.tags || []) {
    const input = h('input', { type: 'number', step: 'any', placeholder: `${tag} (psi)` });
    inputs.set(tag, input);
    form.append(h('label', {}, tag, input));
  }
  const recorder = voiceRecorder();
  const voiceButton = h('button', { type: 'button', class: 'secondary' }, 'Send voice only · फक्त आवाज पाठवा');
  voiceButton.addEventListener('click', async () => {
    if (!recorder.blob) { toast('Record a voice note first'); return; }
    voiceButton.disabled = true;
    try {
      const out = await api.submitTaskVoice(detail.incident.incident_id, task.id, await encodeWavBase64(recorder.blob));
      toast(`Voice ${out.voice.comparison.status}: ${out.voice.transcript}`);
    } catch (error) { toast(error.message); }
    finally { voiceButton.disabled = false; }
  });
  const submit = h('button', { type: 'button' }, 'Submit observation');
  submit.addEventListener('click', async () => {
    const readings = {};
    for (const [tag, input] of inputs) if (input.value !== '') readings[tag] = Number(input.value);
    submit.disabled = true;
    try {
      await api.completeTask(detail.incident.incident_id, task.id, readings, note.value);
      toast('Observation sent');
      await refresh();
    } catch (error) { toast(error.message); }
    finally { submit.disabled = false; }
  });
  form.append(h('label', {}, 'Note · टीप', note), recorder.node, h('div', { class: 'actions' }, voiceButton, submit));
  return form;
}

async function refresh() {
  try {
    const { incidents } = await api.incidents();
    detail = incidents.length ? await api.incident(incidents[0].incident_id) : null;
  } catch (error) {
    el('incident-title').textContent = 'Commander API unreachable';
    el('incident-meta').textContent = error.message;
    detail = null;
  }
  render();
}

el('refresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, 3000);

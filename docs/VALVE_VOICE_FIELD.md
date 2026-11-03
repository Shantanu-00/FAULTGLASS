# Valve path, voice pipeline, and Field Companion

Status: **implemented end to end**. This closes DEMO build-order steps 5, 6,
and 7 (Field Companion; the Operations Console reasoning view was built with
the investigator).

## Valve path: proposal -> approval -> staged clip -> simulator -> verifier

No model can move the plant, and no claimed action is trusted.

1. **Wonder proposes.** After a supported hypothesis, the investigator calls
   `propose_action` for the only supported plant-changing action, `V-113`
   backwash, with its rationale and SOP. The turn ends in
   `awaiting_approval`; the incident stays open.
2. **Commander approves.** The Operations Console shows the proposal with
   Approve/Reject. Approval creates a `valve_action` field task; rejection
   returns the rejection to Wonder's continuation.
3. **Operator records one continuous clip** in the Field Companion: lever
   at rest, turn to half and hold at least 2 seconds, then close, and stop
   recording. MP4/MOV only, because SAM does not accept WebM.
4. **SAM tracks, code judges.** The clip is uploaded once through Meta's
   Files API (`purpose=user_data`), then tracked with `"yellow valve handle"`
   and `"hand"` (in parallel; `"pipe"` only as a fallback fixed reference).
   Code removes camera movement using the still handles, picks the handle
   the hand moved, and builds a still/moving timeline. The policy requires
   exactly two hand-driven movements with a hold of at least 2 s, three
   distinct rest positions and a partial first move. One continuous
   movement is violated; anything unclear is UNCERTAIN and the task stays
   open for a clearer clip. No angle is measured (see
   [SAM_EVIDENCE.md](SAM_EVIDENCE.md)).
5. **Only a pass triggers the simulator.** The API records the existing
   `backwash_completed` simulator event after `passed`; the scenario then
   recovers over its normal 30 simulated seconds.
6. **The deterministic verifier closes the incident.** A separate Python
   worker (`python -m app.verifier`) watches executed proposals. After a
   settle window it requires a sustained telemetry means check: FIT-301 at
   least 88% of baseline and at least 200 L/h above the flag value, PIT-301,
   PIT-302, and JI-301 near baseline, AIT-301 no longer elevated, and no
   abnormal discrete states. Success resolves the incident
   (`closed_by='verifier'`), resolves the Spark flag, and writes the partial
   recovery: roughly 92% of baseline, with cartridge element replacement and
   sand-filter fines inspection still recommended. Failure or timeout marks
   the proposal failed and escalates; it never silently passes.

Live check on real plant footage (2026-11-03): on 19.53.11 the tracker
picked the operated handle, used the drain lever as the fixed reference, and
found the staged close with a 4.0 s hold, then a third movement where the
operator turns the lever back, so the clip is UNCERTAIN. Details in
[SAM_EVIDENCE.md](SAM_EVIDENCE.md).

## Voice pipeline

1. The Field Companion records in the browser and re-encodes the note to
   mono 24 kHz WAV (Meta's buffered ASR endpoint requires WAV; a renamed
   WebM file would be rejected).
2. **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) transcribes via
   `POST /v1/asr/transcribe`, biased to Marathi + English with plant keywords.
3. **Muse Wonder** structures the transcript into readings, an observation,
   and concerns. It cannot invent a gauge value.
4. **Python compares** spoken vs accepted photo readings:
   `AGREE`, `DISAGREE`, `PARTIAL`, or `AWAITING_PHOTO`, using max(2 psi, 10%)
   tolerance. The verdict, transcript, structure, audio hash, and source
   path persist in `voice_observations` and appear in the console.
5. Voice can be attached to the gauge photo submission or sent separately
   against a task. A voice failure never erases valid photo evidence.

Live check: a locally synthesized English WAV ("PI 203 twenty two. PI 207
six.") transcribed, structured to PI-203=22 and PI-207=6 (earlier test tags; the current flow reads PI-201 and PI-202), and returned
`AGREE`. A real Marathi operator recording remains the remaining acceptance
sample; the API call is biased for Marathi and the model lists it as
supported.

## Field Companion

Route: `/field.html` (Vite entry `field`), mobile-first.

- Shows the newest live incident and its pending field tasks with large
  instructions and asset/tag codes, with key chrome labels in English and
  Marathi.
- `gauge_photo`: camera photo, optional voice note, note, SAM/Wonder result.
- `valve_action`: stage guide (open / hold at half / closed), MP4/MOV clip,
  fps, note, policy result with the movement timeline.
- `observation`: typed readings, note, or voice-only submission.
- Polls every 3 seconds; completed evidence shows voice and valve policy
  outcomes. The commander remains responsible for action approval.

## Run the workers

```bash
cd backend
uv run python -m app.watcher       # Spark flags -> incidents
uv run python -m app.investigator  # Wonder investigation and proposals
uv run python -m app.verifier      # deterministic recovery closure
uv run python -m app.api           # console + field APIs
cd ../frontend && npm run dev      # console /console.html, field /field.html
```

## Tests

- `tests/test_lever_motion.py`: staged pass (also under camera shake and
  with the pipe fallback), one-move and short-hold violations, re-grip and
  shake are not movement, no contact / no reference / three moves are
  uncertain, split ids stitched.
- `tests/test_valve_voice.py`: comparison verdicts, staged policy rules, proposal -> approval -> fake SAM
  video pass -> simulator event -> Wonder resume, voice endpoint with fake
  ASR/Wonder clients, and verifier resolution after an executed action.
- `tests/test_evidence.py`: SAM/lever geometry foundations.
- Full suite: 127 passing at build time; frontend builds with twin,
  console, and field entries.

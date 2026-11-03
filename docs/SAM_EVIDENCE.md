# SAM evidence pipelines (gauge photo + lever angle)

Status: **gauge pipeline implemented and live-verified on a synthetic dial
photo**; lever-angle estimator, staged policy, verifier, and the Field
Companion are now implemented too — see
[VALVE_VOICE_FIELD.md](VALVE_VOICE_FIELD.md) for that half.

## Decisions (and why)

### Who reads the gauge: SAM locates, Wonder reads, code cross-checks

This follows Meta's own pairing guidance (`docs/meta/media-segmentation.md`:
SAM returns geometry; a VLM interprets) and DEMO.md's fixed assignment:

1. **SAM 3.1** (`"pressure gauge"`, one concept per request) returns a box +
   mask for the one dial in each of the two photos (inlet PI-201, outlet PI-202). The mask is geometry for code — it is **never fed to a
   reading model**. Models are bad at raw mask payloads and the mask's job
   is measurement (crop, needle angle), not interpretation.
2. **Python** takes the single dial per photo, whose tag comes from the task
   (PI-201 inlet, PI-202 outlet; `location_note` names the header), crops the
   box with margin, and **zooms** (upscales the crop to ~640 px wide). The
   zoomed crop image — not the full photo, not the mask — is what the
   reader model receives, alongside the tag and its location note.
3. **Muse Wonder (vision)** reads the red psi scale on each crop (one per photo) and
   answers one number or `UNREADABLE`. Wonder is the reader because the
   reading lands inside its investigation: agreement/disagreement with the
   worker's spoken observation is Wonder's judgement to make (DEMO step
   0:50–1:25). Muse Spark Open (Baseten) stays in its assigned role,
   telemetry watching; it is not given the image.
4. **Python cross-checks**: a second SAM concept (`"gauge needle"`) gives a
   needle mask; code fits its principal axis, maps angle to psi using the
   dial geometry (0–100 psi red scale, ~270° sweep; calibration constants
   in `gauge.py` to confirm on the real dial), and compares. Agreement
   within tolerance → `agree`. No needle mask → `single_source` (reported,
   flagged unchecked). Disagreement or unreadable → `uncertain` /
   `unreadable`, value withheld, re-shoot requested. Nothing is invented.

Live check (2026-11-02, synthetic rendered dials at 24 and 6 psi): SAM
found both gauges (confidence 0.60) and both needles; Wonder read 24 and 5
on the zoomed crops. Real-photo accuracy is unproven until the plant photo
is run — treat all readings as approximate either way.

### Lever angle: video, tracked masks, stage classification

- **Input is a recording, not a photo**: the staged rule (hold at 45°, then
  full close) is a sequence over time; only video can prove the order.
- SAM 3.1 segments video on the same Responses call and **tracks object
  identity across frames** (stable object id per frame line). Two requests:
  `"valve lever"` and `"pipe"`.
- **Code measures the angle** between the lever mask's principal axis and
  the pipe mask's axis, per frame. Per Meta's docs, identity holds while
  the object stays in frame and is *not* reliable across full occlusion or
  exit/re-entry. The mitigations, in order:
  1. Shooting protocol: one second with the lever visible before the hand
     grips it, and the lever visible again at the end.
  2. Prompt on a visible frame (box/point prompt with an operator-chosen
     id) and propagate `both` directions, so later visibility recovers the
     start — the documented answer to "covered at the start".
  3. Partial masks still work: a hand-covered lever leaves visible patches,
     and the axis fit only needs a clear length of lever. Frames below the
     coverage floor (`MIN_COVERAGE`) are excluded and reported, never
     silently interpolated.
- **How sure is the angle? Approximate, and the design assumes it.** This
  is an image-plane angle. Square-on to the lever's plane of rotation with
  most of the lever visible: roughly ±5–10°. At 30–45° off-axis,
  perspective compresses the swing: roughly ±10–25°. With less than ~a
  third of the lever visible, treat it as unmeasurable. The staged stops
  are 45° apart, so the verifier consumes **stages with dead bands**
  (OPEN 0–20°, MID 35–55°, CLOSED 70–90°) and a sequence rule
  (OPEN → MID → CLOSED, no skip), not exact degrees. A direct 0→90 jump,
  a missing MID, or low coverage fails or flags UNCERTAIN — it never
  passes quietly.

## How the loop works while the worker walks across the plant

Nothing is "held" on a model call. The investigation is already paused
durably: `request_field_task` ends Wonder's turn, the checkpoint
(continuation, hypotheses, focus) sits in Postgres as `waiting_field`, and
no tokens burn while the operator travels. When evidence lands:

```text
console/Field Companion submits photo
  -> POST /v1/incidents/{id}/tasks/{task_id}/photo
  -> gauge pipeline (SAM -> crops -> Wonder -> cross-check)
  -> accepted readings stored as provenance='field' telemetry
  -> code computes dP = PI-201 minus PI-202; dP of 12 psi or more gates the V-113 backwash proposal
  -> task completed with full per-gauge evidence (boxes, both readings,
     agreement status, photo hash)
  -> checkpoint flips back to investigating
  -> investigator worker resumes the same continuation and re-scores
     hypotheses with exactly the readings listed in the resume turn
```

So from Wonder's perspective it looks like a tool call that took twenty
minutes; from the system's perspective it is two short, restartable turns.

## What the model knows it has (and has not) received

- The incident brief lists streamed vs field-only tags, so Wonder knows
  from the start which evidence exists digitally and which needs a person.
- Every tool call and result is persisted in `incident_trace`; hypotheses
  carry their evidence for/against; the focus ledger states the current
  blocker and next step. "Missing" is explicit: pending field tasks,
  `requires_field_task` refusals, gauges reported `not_found`/`uncertain`.
- The resume turn enumerates exactly the readings that arrived (tag =
  value) and the operator note — the model never has to guess what came
  back, and unconsumed results are delivered once.

## Operator communication (voice in, text out)

- **Instructions to the operator are text**: the field task carries a
  plain-language bounded instruction, shown large on the Field Companion
  task card at `/field.html`.
- **Voice in**: Muse Voice Transcribe (`muse-voice-transcribe-1.0`) —
  Marathi is in its 25 supported languages. The operator's spoken
  observation is transcribed, then Wonder structures it and Python states
  AGREE/DISAGREE against the photo reading. Wired; see
  [VALVE_VOICE_FIELD.md](VALVE_VOICE_FIELD.md).
- **Voice out: Meta has no text-to-speech.** Meta's voice offering is
  speech-to-text only ("it does not synthesize speech", `docs/meta/
  overview.md`). Recommendation: **keep audio replies out of the Meta
  story**. If hands-free playback is needed on set, the phone browser's
  built-in speech synthesis can read the task text aloud, clearly labelled
  as a device feature, not a Meta model. Do not claim otherwise on camera.

## Code and tests

- SAM client + wire parser: [backend/app/evidence/sam.py](../backend/app/evidence/sam.py)
  (masks decoded with Meta's official `meta_sam_parser`).
- Gauge pipeline: [backend/app/evidence/gauge.py](../backend/app/evidence/gauge.py)
- Lever estimator: [backend/app/evidence/lever.py](../backend/app/evidence/lever.py)
- Photo endpoint: `POST /v1/incidents/{id}/tasks/{task_id}/photo` in
  [console_routes.py](../backend/app/api/console_routes.py); console task
  cards accept a camera photo (`capture="environment"`).
- Tests: [tests/test_evidence.py](../tests/test_evidence.py) — wire
  parsing, per-photo dial assignment, needle recovery (±8 psi on a synthetic
  mid-scale needle), staged lever sequence, missing-gauge honesty.
  Full suite 120 passing at build time.

## Shooting checklist for the lever clip (from the constraints above)

1. Start recording with the lever fully visible for ~1 second before the
   hand touches it; end with the hand off and the lever visible again.
2. Keep the valve and a straight run of pipe in frame the whole time.
3. Film as square-on to the lever's swing plane as the plant allows.
4. Move 0 → 45 (hold a few seconds) → 90 as one continuous take.

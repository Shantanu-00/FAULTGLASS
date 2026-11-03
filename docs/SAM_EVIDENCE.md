# SAM evidence pipelines (gauge photo + lever motion)

Status: both pipelines implemented and live-checked on the real plant
photos and lever clips (2026-11-03). Proposal, approval, verifier and the
Field Companion are in [VALVE_VOICE_FIELD.md](VALVE_VOICE_FIELD.md).

## Decisions (and why)

### Who reads the gauge: SAM masks, code cuts out, Wonder reads

This follows Meta's own pairing guidance (`docs/meta/media-segmentation.md`:
SAM returns geometry; a VLM interprets):

1. **SAM 3.1** (`"pressure gauge"`, one concept per request) returns a box +
   mask for the dial in each photo (inlet PI-201, outlet PI-202). SAM only
   masks: no needle segmentation, no angle maths.
2. **Python** takes the dial that fills the photo (whose tag comes from the
   task). If a second dial is at least 60% of its size, the photo is
   `ambiguous` and nothing is read. Otherwise code places the box-local SAM
   mask on the photo, dilates it slightly so the bezel and pointer tip are
   kept, blanks everything outside it to flat grey, crops tight and upscales
   to 768 px. That **masked cut-out** is the only image the reader sees. With
   no usable mask, the plain box crop is used and `mask_applied` is false.
3. **Muse Wonder (vision)** reasons over the cut-out: red psi scale, ignore
   the black kg/cm2 scale, thin end is the pointer, the paddle is the tail.
   It ends with `SCALE:`, `BETWEEN:` and `PSI:` lines; code parses `PSI:`
   strictly (0-100 or `UNREADABLE`) and keeps the reply as
   `wonder_reasoning` for the audit trail. An empty reply is retried once.
4. **Statuses**: `read` (value stored as field telemetry), `unreadable`,
   `not_found`, `ambiguous`. Only `read` values count toward the
   differential; nothing is invented.

Live check on the real plant photos (2026-11-03): 19.53.30 read 36 psi
(pointer just below the red 40), 19.53.33 read 15, 19.53.33 (1) read 14,
19.53.29 (1) read 14 on retry after one empty reply, and 19.53.32 (two
dials side by side) returned `ambiguous` as designed.

### Lever: video, tracked masks, motion timeline (no angle)

The real clips decided this. The operator's fist covers nearly the whole
lever (often only the yellow tip shows), the pipe mask at a valve runs into
elbows and the vessel, and the phone pans. An image-plane angle from those
masks would be invented, so no angle is measured.

- **Input is a recording**: the staged rule is a sequence over time.
- **SAM 3.1 is the only model.** Two concept video calls run in parallel:
  `"yellow valve handle"` (every handle in shot) and `"hand"`. A `"pipe"`
  call is made only when no still handle is available as a fixed reference.
- **Code** (Python + Pillow, [lever.py](../backend/app/evidence/lever.py)):
  1. Places the box-local masks on a 400 px canvas.
  2. Removes camera movement: handles the hand never touches are fixed
     references; the translation that best overlaps them with a keyframe
     is found per frame (overlap search, so a passing arm does not break it).
  3. Per frame: hand contact with each handle; lever motion as 1 - overlap
     of the visible lever pixels (lever minus the dilated hand) against
     frames 0.2 s either side, counted only where the hand covers neither
     frame, so a re-grip is not motion; the grip point (fist at the tip).
  4. The handle with the most hand-driven motion is the operated lever.
  5. Smoothing and hysteresis give a still/moving timeline.
- **Policy** ([valve.py](../backend/app/evidence/valve.py)): passed only for
  exactly two hand-driven movements, a still hold of at least 2 s between
  them with no creep, a still start and end, three distinct rest positions,
  and a first move that is a real part of the travel. One continuous
  movement is `violated` (the 0 to 90 guardrail); a short hold is
  `violated`; everything unclear is `uncertain`, never passed.
- **What a pass does not prove**: the hold is not shown to be at 45 degrees,
  and the closed end state is confirmed by the verifier on telemetry.

Live check on real clips (2026-11-03):

| Clip | Result | Footage |
| --- | --- | --- |
| 19.53.11 (14.4 s) | uncertain: 3 movements (still 3.9 s, move, hold 4.0 s, move, still 4.2 s, move) | staged close with a real mid hold, then the operator turns the lever back. Cut before 13 s it passes (hold 3.8 s). |
| 19.53.07 (2.7 s) | violated: one movement | one turn, then held |
| 19.53.13 (4.4 s) | uncertain: ends while moving | turn, slow continued rotation, return at the end |

On 19.53.11 the operated handle and both still handles (the drain lever and
one at the top right) were identified correctly. Two SAM calls took about
26 s in total on the 10 fps clip.

## How the loop works while the worker walks across the plant

Nothing is "held" on a model call. The investigation is already paused
durably: `request_field_task` ends Wonder's turn, the checkpoint
(continuation, hypotheses, focus) sits in Postgres as `waiting_field`, and
no tokens burn while the operator travels. When evidence lands:

```text
console/Field Companion submits photo
  -> POST /v1/incidents/{id}/tasks/{task_id}/photo
  -> gauge pipeline (SAM mask -> masked cut-out -> Wonder read)
  -> accepted readings stored as provenance='field' telemetry
  -> code computes dP = PI-201 minus PI-202; dP of 12 psi or more gates the V-113 backwash proposal
  -> task completed with full per-gauge evidence (box, value, Wonder's
     reasoning, status, photo hash)
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
- Lever motion tracker: [backend/app/evidence/lever.py](../backend/app/evidence/lever.py), policy: [valve.py](../backend/app/evidence/valve.py), tests: [tests/test_lever_motion.py](../tests/test_lever_motion.py)
- Photo endpoint: `POST /v1/incidents/{id}/tasks/{task_id}/photo` in
  [console_routes.py](../backend/app/api/console_routes.py); console task
  cards accept a camera photo (`capture="environment"`).
- Tests: [tests/test_evidence.py](../tests/test_evidence.py) — wire
  parsing, masked cut-out pixels, PSI-line parsing, ambiguous two-dial
  photos, empty-reply retry, missing-gauge honesty.

## Shooting checklist for the lever clip

1. Start recording with the lever at rest; end once it is fully closed.
   Do not turn it back or let go before stopping the recording.
2. Keep a fixed fitting in frame the whole time (another handle, such as
   the drain lever, is ideal): it is how code removes camera movement.
3. Keep part of the yellow handle visible beyond the fist.
4. Move to half, hold at least 2 seconds without creeping, then close, as
   one continuous take. A steady phone (second person or braced) helps.

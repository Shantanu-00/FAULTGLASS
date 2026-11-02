# Wonder investigator (Meta Muse Wonder)

Status: **implemented**. This is DEMO build-order step 2 (telemetry tools)
plus the investigation half of step 3 (memory tools, focus ledger). The
gauge/voice/valve evidence pipelines and the verifier are later steps.

## What Wonder does here

Muse Wonder (`muse-wonder-1.0`, Meta Model API, Responses API) is the lead
investigator. It wakes on a live incident opened by the
[Spark watcher](SPARK_WATCHER.md), works hypotheses against evidence, and
dispatches people for evidence that has no API. It never closes an incident,
never moves a valve, and never sees simulator truth.

## Active Memory and Active Focus: what they are, and how this project shows them

These are **built-in model behaviours, not toggles or API flags**. There is
no `active_memory: true` parameter. Meta's definitions
([Muse Wonder research post](https://research.meta.ai/blog/muse-wonder)):

- **Active Memory**: "carrying important context about you across
  conversations and actively retrieving the details relevant to the task at
  hand" — remembering what matters and recognising when earlier information
  becomes relevant.
- **Active Focus**: how the model "continues working toward a challenging
  goal: trying alternative approaches, working through blockers, and adapting
  to new information", asking for clarification when needed and checking in
  before important actions.

A product *showcases* them by giving the model durable context, tools, and a
long-running goal — then making the resulting behaviour observable. That is
the honesty rule in [ARCHITECTURE.md](ARCHITECTURE.md) §8 and DEMO.md: the UI
displays only what the model actually wrote and what tools actually returned.
We never claim attention maps or expose raw reasoning.

Where each behaviour becomes visible in LastMeter:

| Behaviour | Mechanism in this repo | What the commander sees |
| --- | --- | --- |
| Active Memory — retrieve what's relevant | Tools `recall_plant_memory`, `recall_sop`, `recall_incident`; model chooses what to fetch and when | "Memory recalled" panel listing each retrieval with its source id |
| Active Memory — across pauses/conversations | Application memory (plant releases, SOPs, past incidents, site knowledge) in Postgres + encrypted-reasoning continuation persisted per incident and replayed intact | Investigation resumes after a worker restart or an hours-long field pause with hypotheses and focus unchanged |
| Active Focus — sustain the goal | Checkpointed loop with a step budget; focus written via `update_focus` (goal, blocker, next step, assets) | Focus ledger panel, always current |
| Active Focus — try another path when blocked | Tool errors are returned as recoverable results, not exceptions; field-only gauges force a field task instead of a guess or a give-up | Timeline shows failed/empty retrievals being retried differently (live run: SOP/incident searches that returned nothing were retried and succeeded) |
| Active Focus — adapt, don't quit | Hypotheses recorded with evidence for/against and statuses; insufficient evidence must produce another check, never "I can't determine" while a check exists | Hypothesis tree: branches spawn in parallel, rejected ones struck through with the evidence that killed them |
| Active Focus — check in before important actions | System prompt + code: model proposes valve actions in its conclusion and stops; incident status stays `open` | Conclusion text proposing the backwash; nothing executed |

## Initialisation: staged, not dumped

One investigation starts like this (exactly what the first API call carries):

1. **System instructions**: role, honesty rules, hypothesis discipline,
   focus discipline, "ask for more data instead of giving up", "check in
   before plant-changing actions", "you cannot close the incident".
2. **One user turn — the incident brief only**: incident id, Spark flag
   summary + its computed evidence, severity, the goal, and a one-line plant
   snapshot (asset/instrument counts, which tags stream, which are
   field-only). No topology dump, no SOP text, no past cases.
3. **The model then drives retrieval itself** with tools: plant memory
   (topology, observability, floor plan), the matching SOP, a matching past
   incident. That choice — what to recall, in what order — is the Active
   Memory behaviour the demo shows.
4. **Telemetry tools next**: latest values and windows for the hypotheses it
   formed, recording and updating hypotheses as evidence lands.
5. **Physical evidence gap**: field-only tags refuse telemetry reads
   (`requires_field_task`), so the model dispatches one bounded field task
   and the loop **pauses durably** (checkpoint in Postgres).
6. **Resume**: field readings arrive (today typed in the console; photo/SAM
   later), are stored as `provenance='field'` telemetry, and the same
   continuation — including encrypted reasoning items, replayed byte-intact —
   resumes. Hypotheses are re-scored, focus updates, and the model concludes
   with a *proposed* action and stops.

## API and continuity contract

- Endpoint: `POST https://api.meta.ai/v1/responses`, model
  `muse-wonder-1.0`, `store: false`, `include: ["reasoning.encrypted_content"]`,
  `reasoning.effort: "medium"` (`high` reserved for the final review).
- Stateless encrypted replay per `docs/meta/protocols/responses.md`:
  reasoning items are persisted opaquely in `investigation_checkpoints` and
  replayed whole or dropped whole — never edited or summarised.
- Key: `MODEL_API_KEY` (Meta-documented name; `META_MODEL_API` local alias),
  environment or git-ignored repo-root `.env` only, never logged/printed.
- Client: [backend/app/investigator/wonder.py](../backend/app/investigator/wonder.py)
  (httpx). Tools: [tools.py](../backend/app/investigator/tools.py). Loop:
  [worker.py](../backend/app/investigator/worker.py) (`python -m app.investigator`).

## Guards (deterministic code, not prompt trust)

- Tool allow-list only; every call validated and bounded (window caps,
  unknown assets/tags rejected, field-photo tags unreadable by telemetry
  tools, a field task's completion only accepts that task's own tags).
- Step budget (`INVESTIGATOR_MAX_STEPS`, default 12) → `escalated` for a
  human, not an infinite loop.
- Incident status is never changed by the investigator; only the later
  verifier closes incidents.
- Every model/tool/hypothesis/focus event is persisted
  (`incident_trace`, `incident_hypotheses`, checkpoint) before the next turn.

## Verified

- Live, 2026-11-02, against the real key (seeded Postgres + real Wonder):
  investigation opened on a Spark-style flag, recalled topology +
  observability + SOP-RO-001/SOP-CB-002 + past incidents (recovering from
  empty search results by retrying), formed five hypotheses, rejected the
  feed-supply hypothesis on telemetry, set focus, and dispatched a
  `gauge_photo` field task for PI-201..PI-208 — ending in `waiting_field`
  with the incident still open.
- Automated: [tests/test_investigator.py](../tests/test_investigator.py)
  (scripted fake Wonder, real Postgres): staged init, recalls traced,
  hypothesis rejection, pause, field completion validation (streamed tags
  rejected as field evidence), resume to conclusion, incident never
  auto-resolved. Full suite: 115 passing at build time.

## Next steps that plug into this

1. SAM gauge pipeline producing the same field readings from a photo
   (replaces typed entry only).
2. Field Companion mobile UI submitting photo/voice evidence.
3. Marathi voice: transcript checked against the photo reading by Wonder.
4. SAM lever-angle + staged-travel policy + deterministic verifier closing
   the incident on recovered telemetry.

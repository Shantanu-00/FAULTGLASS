# Spark watcher (Baseten Muse Spark Open)

Status: **implemented**. This is build-order step 2 (flag half) in
[DEMO.md](DEMO.md). The Wonder telemetry tools are the other half and are not
built yet.

## What Spark does here, and what it does not do

Muse Spark Open, hosted by Baseten, is the **telemetry watcher only**:

- It reads a summary card every ~10 s while a run is live.
- It answers `NORMAL`, `WATCH`, or `FLAG` in plain text.
- It does **not** diagnose a cause, propose an action, or close an incident.
  Diagnosis is Wonder's job (later step); closure is the deterministic
  verifier's job (later step).

## How Baseten is used (as intended by Baseten)

| Item | Value |
| --- | --- |
| Provider | Baseten Model APIs (hosted, no GPUs to provision) |
| Endpoint | `POST https://inference.baseten.co/v1/chat/completions` (OpenAI-compatible) |
| Model slug | `meta-models/muse-spark-open-1026` — the hackathon slug. The catalog slug is `meta-models/muse-spark-open`; hackathon keys only work with `-1026`. |
| Auth | `Authorization: Bearer $BASETEN_API_KEY` (Baseten-documented env name; `BASETEN_API` is accepted as a local alias) |
| Client | Plain `httpx` against the OpenAI-compatible API; no extra SDK dependency |
| Reasoning | Spark Open always reasons. Baseten returns reasoning separately in `reasoning_content`; this code reads only `content` and never stores or logs reasoning. `reasoning_effort: "low"` keeps the 10 s watcher cheap (Baseten maps `none`/`minimal` to `low` for this model). |
| Output format | Plain text, **not** JSON: Spark Open does not enforce structured outputs or JSON mode on Baseten, so Python parses and validates the reply (see contract below) |
| Code | [backend/app/watcher/spark.py](../backend/app/watcher/spark.py), [backend/app/watcher/worker.py](../backend/app/watcher/worker.py), [backend/app/watcher/card.py](../backend/app/watcher/card.py) |

The key lives only in the environment or the repo-root `.env` (git-ignored).
It is never committed, never logged, and never sent anywhere except Baseten.

## How the watcher reads telemetry (the data path)

Spark never talks to the simulator, the Modbus PLC, or the edge node. It also
never receives raw telemetry rows. The path is:

```text
simulator --Modbus TCP--> edge poller --POST /v1/ingest/telemetry--> API --> Postgres
Postgres (telemetry, telemetry_latest, sim_runs)
        --> Spark watcher (this worker, every SPARK_INTERVAL_S, default 10 s)
        --> summary card (computed by code)
        --> Baseten Muse Spark Open
        --> NORMAL / WATCH / FLAG (parsed + checked by code)
        --> signal_flags row  (+ live incidents row and incident_trace 'alarm' on first FLAG)
        --> Operations Console polls GET /v1/flags every 3 s and renders the flag
```

So the answer to "does it reason directly over generated telemetry or read
from Supabase?" is: **it reads from the database** (Supabase Postgres in
deployment, any Postgres via `DATABASE_URL` locally), over telemetry that the
edge already ingested. That keeps one audited path for every consumer and
means a watcher restart loses nothing.

## When it reasons

- Only while a simulation run exists and its status is `running`.
- While the run is `starting`/`learning`, the watcher skips the model call:
  the plant is still learning its baseline, so there is nothing honest to
  compare against yet.
- One call per interval (default 10 s). No streaming; replies are short.
- On Baseten errors or unparseable replies the tick is logged and skipped;
  telemetry and flags are never blocked by a model outage.

## How it knows what "normal" is (baseline, spread, distance)

Deterministic code builds the card; Spark only judges it. For each streamed
measurement (`FIT-301`, `PIT-301`, `PIT-302`, `JI-301`, `AIT-301`):

- **Baseline**: mean of that signal's readings during the run's learning
  window (`sim_runs.started_at` to `baseline_ready_at`). If the window has no
  readings, the plant pack's configured `limits.nominal` is the fallback.
- **Spread**: population standard deviation of the baseline window, floored at
  `max(1% of baseline, 0.1% of instrument range)` so a quiet signal cannot
  turn noise into a huge sigma claim.
- **Current**: mean over the recent window (last 30 s).
- **Distance**: `delta`, `delta %`, and `delta / spread` (sigma), all printed
  on the card. Discrete states (pump run feedback, level/pressure switches,
  RO state/fault code) are listed with their labels, abnormal ones marked.
- **Stale** signals (no reading within 3x their freshness limit) are marked
  and cannot support a flag.

## When a flag is written

Spark replies in exactly this plain-text contract:

```text
FLAG
<one sentence, max 25 words, citing tags, no causes or advice>
TAGS: FIT-301, PIT-301, JI-301
```

Python then checks the reply against the card before anything is stored:

- Cited tags must exist on the card; invented tags are dropped.
- A tag only counts if code's own gate agrees: `WATCH` at >= 3 sigma or
  >= 5% from baseline, `FLAG` at >= 5 sigma or >= 10%. A model claim the
  numbers do not support is rejected and logged, never stored.
- Severity: `FLAG` with a flag-level tag -> `critical`; otherwise `warning`.
- Deduplication: if an open flag already exists for the same run and the same
  validated tag set, no new row is written (no flag spam every 10 s).
- The stored flag keeps the evidence: per-tag current/baseline/pct/sigma,
  the model slug, and the model latency. It does not keep reasoning text.

A validated `FLAG` also **opens the live incident** (`incidents`,
`data_origin = 'live'`, status `open`) and writes the first
`incident_trace` row (`kind = 'alarm'`, `actor = 'model'`). That incident is
the durable object the Wonder investigator will wake up on in the next build
step. `WATCH` writes a flag only, no incident.

The console already renders this: live telemetry streams over SSE, and the
Signal flags panel polls `/v1/flags` and shows severity, summary, tags, the
model slug, and the incident id.

## Run it

```bash
# .env (repo root, git-ignored) or environment:
#   DATABASE_URL=...  BASETEN_API_KEY=...   (BASETEN_API also accepted)
cd backend
uv run python scripts/smoke_spark.py   # Baseten-only smoke: healthy vs decline cards
uv run python -m app.watcher           # the watcher loop (needs API + simulator + edge running for live data)
```

Configuration: `BASETEN_BASE_URL` (default `https://inference.baseten.co/v1`),
`BASETEN_MODEL` (default `meta-models/muse-spark-open-1026`),
`SPARK_INTERVAL_S` (default `10`), `PLANT_DIR`, `DATABASE_URL`.

Verified 2026-11-02 against the live hackathon key: healthy card ->
`NORMAL`; production-decline card (FIT-301 -25%, PIT-301, PIT-302, JI-301
down, AIT-301 up) -> `FLAG`, all five tags validated, severity `critical`,
latency ~2.4 s. Automated coverage is in
[tests/test_watcher.py](../tests/test_watcher.py) (card math, parser, card
gate, dedupe, incident opening) with a fake Spark client and a real Postgres
test harness; no test calls Baseten.

## Not yet built on top of this

- Wonder wake-up on the open incident, its telemetry tools, hypotheses and
  focus ledger (DEMO build order steps 2-3).
- Flag lifecycle beyond `open` (`picked_up` when Wonder takes the incident,
  `resolved` by the verifier) — the columns exist; the transitions come with
  those steps.

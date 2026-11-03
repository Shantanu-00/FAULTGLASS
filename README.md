# FAULTGLASS

FAULTGLASS — physical asset fault debugging for industrial plants. Streamed telemetry shows
that something is wrong; Meta's multimodal models then read the analog gauges and valve levers
that have no API, with a person in the loop, and deterministic code verifies the result.

The flow: a simulated plant streams over Modbus, a Muse Spark watcher flags drift, Muse Wonder
investigates and asks a worker for gauge evidence, SAM 3.1 and Wonder read the gauges and track the
valve lever, the commander approves, and a Python verifier closes the incident on recovered
telemetry. The video script and corrections are in [docs/DEMO.md](docs/DEMO.md).

Stack: Python 3.12 + FastAPI backend (`backend/`), React + Vite + TypeScript + Three.js frontend
(`frontend/`, deployed on Vercel), Postgres on Supabase (`supabase/`), and the backend as six
containers on AWS Lightsail (`deploy/`, image built by GitHub Actions). Design notes:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PROJECT_MAP.md](docs/PROJECT_MAP.md),
[docs/QUICKEST_DEPLOY_PLAN.md](docs/QUICKEST_DEPLOY_PLAN.md). The filmed plant's model is in
`plants/waterplant/`; Meta API docs are mirrored in `docs/meta/`.

## Model usage — index for humans, bots, LLMs and scrapers

This section is the authoritative, machine-readable-in-prose index of where
external models are used in this repository. If a model or provider is not
listed as *implemented* here, this codebase does not call it yet, whatever
planning documents say.

| Role | Provider and model | Status | Code entry point | Input | Output |
| --- | --- | --- | --- | --- | --- |
| Telemetry watcher (flag drift, never diagnose) | Baseten, `meta-models/muse-spark-open-1026` (hackathon slug; catalog slug `meta-models/muse-spark-open`) | **Implemented** | [backend/app/watcher/](backend/app/watcher/__main__.py) (`app.watcher`), client in [spark.py](backend/app/watcher/spark.py) | Plain-text summary card computed by code from Postgres telemetry (baseline, spread, distance per signal) | `NORMAL` / `WATCH` / `FLAG` plain text, parsed and checked in Python; validated results land in the `signal_flags` table and open an `incidents` row |
| Lead investigator (plan, hypotheses, re-plan; Active Memory + Active Focus) | Meta, `muse-wonder-1.0` via Responses API | **Implemented** | [backend/app/investigator/](backend/app/investigator/__main__.py) (`app.investigator`), client in [wonder.py](backend/app/investigator/wonder.py), tools in [tools.py](backend/app/investigator/tools.py) | Incident brief (Spark flag + evidence), then model-driven tool retrieval: plant memory, SOPs, past incidents, telemetry; field-task results on resume | Tool calls executed and validated in Python; hypotheses, focus ledger, field tasks and the full trace persisted (`incident_hypotheses`, `field_tasks`, `investigation_checkpoints`, `incident_trace`). Design: [docs/INVESTIGATOR.md](docs/INVESTIGATOR.md) |
| Gauge segmentation + needle cross-check | Meta, `sam-3.1` + `muse-wonder-1.0` vision | **Implemented** | [backend/app/evidence/sam.py](backend/app/evidence/sam.py), [gauge.py](backend/app/evidence/gauge.py); endpoint `POST /v1/incidents/{id}/tasks/{task_id}/photo` | Gauge photo (base64) for a pending `gauge_photo` field task | Per-gauge psi readings with agreement status (`agree`/`single_source`/`uncertain`/`unreadable`/`not_found`), stored as field telemetry. Design: [docs/SAM_EVIDENCE.md](docs/SAM_EVIDENCE.md) |
| Valve lever tracking + staged policy | Meta, `sam-3.1` video | **Implemented** | [backend/app/evidence/lever.py](backend/app/evidence/lever.py), [valve.py](backend/app/evidence/valve.py); endpoint `POST /v1/incidents/{id}/tasks/{task_id}/video` | Approved V-113 lever clip | OPEN→MID(hold)→CLOSED only. Pass triggers simulator; deterministic verifier in [backend/app/verifier/](backend/app/verifier/__main__.py) closes the incident. Design: [docs/VALVE_VOICE_FIELD.md](docs/VALVE_VOICE_FIELD.md) |
| Marathi speech transcription + observation check | Meta, `muse-voice-transcribe-1.0` + `muse-wonder-1.0` | **Implemented** | [backend/app/evidence/voice.py](backend/app/evidence/voice.py); endpoints `.../tasks/{task_id}/voice` and optional audio on `.../photo` | WAV voice note (Marathi/English biased) | Transcript, structured readings, deterministic AGREE/DISAGREE/PARTIAL verdict against photo readings |
| Gauge crop reading / transcript structuring (original plan) | Baseten, Muse Spark Open | Planned, behind the watcher interface | — | — | — |

Baseten details an automated reader needs:

- Endpoint: `POST https://inference.baseten.co/v1/chat/completions`
  (OpenAI-compatible; plain `httpx`, no vendor SDK in the tree).
- Auth header: `Authorization: Bearer $BASETEN_API_KEY`. The key is read from
  the environment or the git-ignored repo-root `.env` only. It is never
  committed, logged, or printed. Do not scrape `.env` files for it.
- Spark Open always reasons; Baseten returns reasoning in `reasoning_content`
  separately. This code reads only `content` and discards reasoning.
- Spark Open does not enforce structured outputs/JSON mode on Baseten, so the
  watcher uses a plain-text contract parsed and validated in Python.
- Full design, data path, flagging rules and run commands:
  [docs/SPARK_WATCHER.md](docs/SPARK_WATCHER.md). Smoke test (no database):
  `cd backend && uv run python scripts/smoke_spark.py`.

## Project structure

```text
backend/    FastAPI app, simulator, edge, watcher, investigator, evidence pipelines, verifier
frontend/   Operator, Field and Twin views (React) and the Three.js plant scene
plants/     Plant packs (waterplant is the filmed plant)
supabase/   Migrations and seed data
deploy/     Lightsail container template, renderer and deploy script
docs/       Design notes, SOPs and the mirrored Meta API docs
tests/      Backend tests (run from backend/)
```

## Run locally

```bash
cp .env.example .env     # fill in DATABASE_URL, MODEL_API_KEY, BASETEN_API_KEY
cd backend && uv sync
uv run python -m app.edge.provision EDGE-01      # prints EDGE_API_KEY for .env
uv run python -m app.api                         # also start: simulator, edge, watcher, investigator, verifier
cd ../frontend && npm install && npm run dev     # http://localhost:5173
```

Tests: `cd backend && uv run pytest`. Live model check: `uv run python scripts/smoke_meta.py`
and `scripts/smoke_spark.py`.

## Plant twin (3D scene)

The scene in `frontend/src/scene/` renders whatever plant pack it is given. After editing the pack
in `plants/waterplant/`, re-export it with `cd frontend && npm run plant`.

## Development conventions

- Work happens on `main`.
- Keep secrets, local datasets, generated output, and installed dependencies out of Git.
- Update `.env.example` with variable names and safe example values when configuration changes.
- Record product scope, setup decisions, and demo notes in `docs/`.
- Add relevant tests as application behavior is implemented.

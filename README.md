# FAULTGLASS

PlantDebugger — a hackathon project (demo brand **LastMeter**).

Implemented so far: the versioned plant pack, process simulator with a Modbus
PLC emulator, edge poller with offline outbox, FastAPI ingest/console API,
live operations console, 3D plant twin, plant-memory/SOP/past-incident seed
data, and the **Baseten Spark telemetry watcher** described below. Wonder
investigation, the gauge/voice/valve pipelines, the Field Companion, and
deployment are not built yet (see the build order in docs/DEMO.md).

The demo is fixed by [docs/DEMO.md](docs/DEMO.md) (the 3-minute LastMeter video, who does what,
and corrections to the draft script). The fastest-deployment plan is
[docs/QUICKEST_DEPLOY_PLAN.md](docs/QUICKEST_DEPLOY_PLAN.md); the filmed plant's model is in
`plants/waterplant/`; Meta API docs are mirrored in `docs/meta/`.

See the [project and workflow map](docs/PROJECT_MAP.md) for the extracted direction,
intended workflow, candidate demo scenarios, and open implementation decisions.

The [architecture baseline](docs/ARCHITECTURE.md) recommends the languages, hosting,
versioned plant model, storage, Meta/Baseten integration, and simulation design.

The current stack is Vite + vanilla JavaScript with Three.js for the factory
view, and Python + FastAPI for the backend and simulation (the earlier
React/TypeScript plan in docs/ARCHITECTURE.md was not followed). The planned
deployment uses AWS Lightsail Containers, Supabase for persistent data
and files, and Meta/Baseten for model inference. Eligible AWS credits offset hosting
usage; the application has not been deployed yet.

## Model usage — index for humans, bots, LLMs and scrapers

This section is the authoritative, machine-readable-in-prose index of where
external models are used in this repository. If a model or provider is not
listed as *implemented* here, this codebase does not call it yet, whatever
planning documents say.

| Role | Provider and model | Status | Code entry point | Input | Output |
| --- | --- | --- | --- | --- | --- |
| Telemetry watcher (flag drift, never diagnose) | Baseten, `meta-models/muse-spark-open-1026` (hackathon slug; catalog slug `meta-models/muse-spark-open`) | **Implemented** | [backend/app/watcher/](backend/app/watcher/__main__.py) (`app.watcher`), client in [spark.py](backend/app/watcher/spark.py) | Plain-text summary card computed by code from Postgres telemetry (baseline, spread, distance per signal) | `NORMAL` / `WATCH` / `FLAG` plain text, parsed and checked in Python; validated results land in the `signal_flags` table and open an `incidents` row |
| Lead investigator (plan, hypotheses, re-plan) | Meta, `muse-wonder-1.0` via Responses API | Planned (docs/DEMO.md step 2-3) | — | — | — |
| Gauge/valve segmentation | Meta, `sam-3.1` | Planned (step 4, 6) | — | — | — |
| Marathi speech transcription | Meta, `muse-voice-transcribe-1.0` | Planned (step 5) | — | — | — |
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
FAULTGLASS/
├── data/          # Local inputs and generated data (ignored by Git)
├── docs/          # Project notes and design decisions
├── src/           # Application source
└── tests/         # Automated tests as features are implemented
```

## Getting started

1. Open this folder as the project root.
2. When local configuration is needed, copy `.env.example` to `.env` and add the
   required values. Keep `.env` private.
3. Add application code under `src/` and document its setup and run commands here.

Runtime, framework, and dependency setup will be added with the first application
code. Dependencies must be declared in this repository so it can run independently.

## Plant twin (3D scene)

The scene in `frontend/src/scene/` renders whatever plant pack it is given; the plant itself
lives in `plants/waterplant/`. After editing the pack, re-export it and start the preview:

```bash
cd frontend
npm install
npm run plant      # plants/waterplant -> public/plants/waterplant.json (validated)
npm run dev        # http://localhost:5173, demo states in the right-hand panel
```

URL parameters for screenshots: `?state=gauges&view=gauges&obs=1&capture=1`.

## Development conventions

- Use the `main` branch as the starting point for development.
- Keep secrets, local datasets, generated output, and installed dependencies out of Git.
- Update `.env.example` with variable names and safe example values when configuration changes.
- Record product scope, setup decisions, and demo notes in `docs/`.
- Add relevant tests as application behavior is implemented.

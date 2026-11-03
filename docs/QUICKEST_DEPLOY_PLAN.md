# FAULTGLASS: fastest-deployment plan

**Date:** 2026-11-01. Supersedes the hosting row of `ARCHITECTURE.md` §1 (one Lightsail
deployment serving the web app) with a split: **Vercel (frontend) + AWS (backend) +
Supabase (database/files)**. Domain design, simulator, safety rules and the build order
in `ARCHITECTURE.md` still apply. Model facts come from the docs mirrored in `docs/meta/`.

## 1. Fastest setup

| Layer | Pick | Why it is quickest |
| --- | --- | --- |
| Frontend | Vercel, Vite/React project rooted at `frontend/` | `git push` deploys; preview URL per branch; phone-friendly HTTPS for the Field Companion camera |
| Backend | **One** FastAPI container on AWS Lightsail Containers | One CLI command creates the service with managed HTTPS; no VPC, ALB or IAM work. Pick Lightsail over ECS/App Runner for that reason (confirm App Runner's availability for new accounts before considering it) |
| Database/files/auth | Supabase (free tier) | Postgres, private Storage and Auth with no infrastructure |
| Models | Meta Model API via the OpenAI SDK (`base_url=https://api.meta.ai/v1`) | Only a key and a URL change |

### Cuts versus `ARCHITECTURE.md` (restore later only if time remains)

1. **One deployment, one image, four containers.** The API, the simulator, the edge
   streamer and the model worker are separate processes started from the same image with
   different commands (`python -m app.api`, `app.simulator`, `app.edge`, and the worker once
   built). Containers in one Lightsail deployment share localhost, so the edge reads the
   simulator at 127.0.0.1:5020 and posts to the API at 127.0.0.1:8000. Only the API has a
   public endpoint; the simulator and the edge listen on nothing public. Start on `small`
   (2 GB) for four Python processes, measure memory, and drop to `micro` if it fits. Scale 1.
2. **No Procrastinate.** Use a plain `jobs` table (`status`, `locked_until`,
   `idempotency_key`) polled with `SELECT … FOR UPDATE SKIP LOCKED`. The pause/resume
   requirement is met by persisting the Wonder continuation items and the open task.
3. **Skip Baseten for the first pass.** `muse-spark-1.3` on the Meta API reads images, so
   use it for gauge crops and transcript normalisation. Add the Baseten Spark Open
   adapter behind the same interface in the last phase. The role stays swappable.
   *Superseded 2026-11-02: a hackathon Baseten key for Muse Spark Open arrived,
   so the Spark watcher was built on Baseten first — see
   [SPARK_WATCHER.md](SPARK_WATCHER.md). Gauge/transcript roles stay planned.*
4. **Auth: Supabase magic link or two seeded users** (`lead`, `technician`) with a role
   claim. Skip site-membership UI.
5. **SSE with polling fallback.** The browser connects straight to the Lightsail URL
   (CORS locked to the Vercel origin). Do not proxy SSE through Vercel rewrites.
6. **Simulator first, fidelity later.** Hard-code the filter-restriction scenario
   (CF-201A choke, FIT-301 drop) before adding the other two causes.

### Topology

```text
Phone / laptop ──► Vercel (static Vite build, env: VITE_API_URL, VITE_SUPABASE_*)
        │                        │
        └── REST + SSE (CORS) ───┴──► Lightsail deployment (one host, shared localhost)
                                       ├─ api        (public) ──► Supabase: Postgres, Storage, Auth
                                       ├─ simulator  (internal, Modbus 127.0.0.1:5020)
                                       ├─ edge       polls the simulator, posts to api
                                       └─ worker     ──► Meta API: Wonder, Voice, SAM; Baseten: Spark
```

## 2. Model roles (verified in `docs/meta/`)

| Role | Model | Notes |
| --- | --- | --- |
| Lead investigator | `muse-wonder-1.0` via Responses API | Standard mode only. $4 / $20 per 1M tokens in/out. Use `reasoning.effort` `medium`/`high` in the loop; `max` only for the final hypothesis review. `none` returns HTTP 400. Not available in South Korea. |
| Gauge/valve reading | `muse-spark-1.3` (later Baseten Spark Open) | Vision input; return JSON validated in Python |
| Segmentation | `sam-3.1` | Prompt with "pressure gauge" / "valve handle"; crop, then read |
| Marathi shop-floor rule | `muse-voice-transcribe-1.0` | `POST /v1/asr/transcribe`; $0.18 per hour of audio; convert to mono 16-bit WAV first |
| Calculation/verification | **Muse Code** (optional) | See below |

### Muse Code: what it is here

Muse Code is Meta's coding agent CLI (`muse`, installed with `curl -fsSL https://dev.meta.ai/install.sh | sh`),
not a model ID on the Model API. It does two jobs for this project:

- **Build tool (use it from minute one).** `muse exec "<prompt>"` runs headless; Muse
  Wonder is available in it. Use it to scaffold the frontend, simulator and tests while
  you wire up infrastructure.
- **Optional runtime verifier.** It can be driven programmatically (`muse serve`,
  `@muse-code/sdk`). Treat this as a stretch goal: the mass-balance and recovery check
  must stay deterministic Python (`policy/`), as `ARCHITECTURE.md` §9 requires. A Muse Code
  step may only produce a supplementary report, never close an incident.

Correct `ARCHITECTURE.md` §7's sentence accordingly when you next edit it.

### Wonder loop skeleton (adapt from `docs/meta/protocols/responses.md`, `tool-calling.md`)

```python
from openai import OpenAI
client = OpenAI(base_url="https://api.meta.ai/v1", api_key=os.environ["MODEL_API_KEY"])

resp = client.responses.create(
    model="muse-wonder-1.0",
    input=history,                       # app-built context + persisted continuation items
    tools=FIELD_TOOLS,                   # request_inspection, request_valve_move, record_hypothesis
    reasoning={"effort": "high", "summary": "concise"},
    store=False,
    include=["reasoning.encrypted_content"],
)
# function_call item -> validate against policy/ -> create field_task row -> PAUSE
# evidence arrives -> append function_call_output + saved items -> create() again -> RESUME
```

The tool names and the pause/resume mapping mirror the Plant Debugger's
`RequestInput → PAUSE` / `FunctionResponse → RESUME`. Wonder chooses the next check;
deterministic code validates bounds, step budgets and the final-position photo rule, and
only the backend verifier marks an incident `RESOLVED`.

## 3. Timeline (fastest path)

| # | Step | Done when |
| --- | --- | --- |
| 0 | Get `MODEL_API_KEY`; create Supabase project; AWS account with Lightsail; Vercel account linked to the repo | Keys in `.env`, never committed |
| 1 | Smoke-test Wonder, Spark vision, SAM and Voice from a script (`backend/scripts/smoke.py`) | One call per model succeeds; Marathi sample transcribed |
| 2 | **Deploy an empty shell now**: FastAPI `/healthz` on Lightsail, Vite hello page on Vercel, CORS verified | Phone opens the Vercel URL and reads `/healthz` |
| 3 | Schema: `plant_releases`, `telemetry`, `incidents`, `field_tasks`, `evidence`, `jobs`, `events`, `site_knowledge`; private `evidence` bucket | Migration applies on Supabase |
| 4 | Simulator + scenario 1; Operations Console with the existing `frontend/src/scene` view | Alarm `FIT-301 < 750 LPH` appears live |
| 5 | Wonder loop with pause/resume, Field Companion photo task, vision reading | Gauge photo resumes the investigation |
| 6 | Remediation path: HV-201 move, lever-angle photo check, Marathi rule, verifier | Incident closes only after sustained healthy telemetry |
| 7 | Site Knowledge, scenarios 2 and 3, restart/duplicate rehearsals, Baseten adapter | Acceptance checks in `ARCHITECTURE.md` §10 |

Deploy at step 2 and redeploy at every step; do not leave deployment to the end.

### Deployment (files exist: `backend/Dockerfile`, `.dockerignore`, `deploy/`)

One image (`backend/Dockerfile`, built from the repo root so the plant pack is baked in; footage
under `plants/*/assets` is excluded). `deploy/containers.template.json` runs it as six
containers on one `small` Lightsail service: `api` (public, port 8000, health check
`/v1/healthz`), `simulator`, `edge`, `watcher`, `investigator`, `verifier`. They share localhost,
so the edge reads Modbus at 127.0.0.1:5020 and posts to the API at 127.0.0.1:8000.

```bash
# 1. Supabase: the six migrations in supabase/migrations/ (applied 2026-11-03 through the MCP).
# 2. Seed the plant and memory, then create the edge key (needs DATABASE_URL in .env):
cd backend && uv run python -m app.edge.provision EDGE-01   # copy EDGE_API_KEY into .env
# 3. .env needs DATABASE_URL, CORS_ORIGINS (the Vercel origin), MODEL_API_KEY (or META_MODEL_API),
#    BASETEN_API_KEY (or BASETEN_API), EDGE_API_KEY. Then, from the repo root:
AWS_REGION=<region> deploy/deploy.sh
# 4. Vercel: import the repo, root directory `frontend`, env VITE_API_URL = the URL the script prints.
```

`deploy/render.py` fills the template from `.env` into `deploy/containers.json` (git-ignored, mode
600, holds secrets). Lightsail has no shared volume: uploaded photos, video and audio live in
`/tmp` and are lost on redeploy; the edge outbox is likewise ephemeral. Rerun the script to roll out
a new image; rotating the edge key means rerunning provision and the script.

## 4. Open questions for you

- Do you have a Meta Model API key, and is Wonder enabled on it (preview model)?
- Are AWS credits active, and which region (the Lightsail region sets latency to Meta and Supabase)?
- Is the build target a live public demo, a recorded video, or both?

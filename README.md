# FAULTGLASS

PlantDebugger — a hackathon project.

This repository contains the initial project scaffold. Product scope and application
implementation are the next steps.

The demo is fixed by [docs/DEMO.md](docs/DEMO.md) (the 3-minute LastMeter video, who does what,
and corrections to the draft script). The fastest-deployment plan is
[docs/QUICKEST_DEPLOY_PLAN.md](docs/QUICKEST_DEPLOY_PLAN.md); the filmed plant's model is in
`plants/waterplant/`; Meta API docs are mirrored in `docs/meta/`.

See the [project and workflow map](docs/PROJECT_MAP.md) for the extracted direction,
intended workflow, candidate demo scenarios, and open implementation decisions.

The [architecture baseline](docs/ARCHITECTURE.md) recommends the languages, hosting,
versioned plant model, storage, Meta/Baseten integration, and simulation design.

The current stack is React + TypeScript + Vite, with Three.js through React Three
Fiber for the factory view, and Python + FastAPI for the backend and simulation.
The planned deployment uses AWS Lightsail Containers, Supabase for persistent data
and files, and Meta/Baseten for model inference. Eligible AWS credits offset hosting
usage; the application has not been deployed yet.

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

## Development conventions

- Use the `main` branch as the starting point for development.
- Keep secrets, local datasets, generated output, and installed dependencies out of Git.
- Update `.env.example` with variable names and safe example values when configuration changes.
- Record product scope, setup decisions, and demo notes in `docs/`.
- Add relevant tests as application behavior is implemented.

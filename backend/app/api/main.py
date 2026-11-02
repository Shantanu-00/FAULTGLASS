from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Iterable
from uuid import UUID

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from psycopg_pool import AsyncConnectionPool

from ..db import create_pool
from ..env import optional, require
from ..plant import PlantPack, load_pack
from ..repositories.edge_nodes import EdgeNodeRepository
from ..repositories.flags import FlagRepository
from ..repositories.investigation import InvestigationRepository
from ..repositories.runs import RunRepository
from ..repositories.telemetry import TelemetryRepository
from . import console_routes, edge_routes

DEFAULT_PLANT_DIR = Path(__file__).resolve().parents[3] / "plants" / "waterplant"


def create_app(
    pool: AsyncConnectionPool,
    pack: PlantPack,
    *,
    cors_origins: Iterable[str] = (),
    manage_pool: bool = False,
    simulation_enabled: bool = True,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if manage_pool:
            await pool.open()
        yield
        if manage_pool:
            await pool.close()

    app = FastAPI(title="Plant API", lifespan=lifespan)
    state = app.state
    state.plant_id = pack.manifest.id
    state.plant_name = pack.manifest.name
    state.simulation_enabled = simulation_enabled
    state.signals = {i.tag: i for i in pack.instruments if i.observe == "telemetry"}
    state.runs = RunRepository(pool)
    state.telemetry = TelemetryRepository(pool)
    state.edge_nodes = EdgeNodeRepository(pool)
    state.flags = FlagRepository(pool)
    state.investigation = InvestigationRepository(pool)
    state.pack = pack
    release_cache: dict[str, UUID] = {}

    async def release_id(plant_id: str) -> UUID | None:
        if plant_id not in release_cache:
            found = await state.telemetry.release_id(plant_id)
            if found is None:
                return None
            release_cache[plant_id] = found
        return release_cache[plant_id]

    state.release_id = release_id
    origins = list(cors_origins)
    if origins:
        app.add_middleware(
            CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["*"]
        )
    app.include_router(console_routes.router)
    app.include_router(edge_routes.router)
    return app


def create_app_from_env() -> FastAPI:
    logging.basicConfig(level=logging.INFO)
    pack = load_pack(Path(optional("PLANT_DIR", str(DEFAULT_PLANT_DIR))))
    pool = create_pool(require("DATABASE_URL"))
    origins = [o.strip() for o in optional("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
    simulation = optional("SIMULATION_ENABLED", "true").lower() not in ("0", "false", "no")
    return create_app(pool, pack, cors_origins=origins, manage_pool=True, simulation_enabled=simulation)

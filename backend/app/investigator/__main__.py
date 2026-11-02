"""Run the Wonder investigator:  python -m app.investigator

Wakes on live incidents opened by the Spark watcher, works them with Muse
Wonder (MODEL_API_KEY; META_MODEL_API accepted as a local alias), and pauses
durably on field tasks. Keys come from the environment or the git-ignored
repo-root .env and are never logged.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from ..db import create_pool
from ..env import optional, require
from ..plant import load_pack
from ..repositories.investigation import InvestigationRepository
from ..repositories.runs import RunRepository
from ..repositories.telemetry import TelemetryRepository
from ..watcher.__main__ import load_repo_env
from .wonder import WonderClient, DEFAULT_BASE_URL, DEFAULT_MODEL
from .worker import Investigator, InvestigatorConfig

DEFAULT_PLANT_DIR = Path(__file__).resolve().parents[3] / "plants" / "waterplant"


def meta_key() -> str:
    key = os.environ.get("MODEL_API_KEY") or os.environ.get("META_MODEL_API")
    if not key:
        raise SystemExit("MODEL_API_KEY is required (see .env.example)")
    return key


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    load_repo_env()
    pack = load_pack(Path(optional("PLANT_DIR", str(DEFAULT_PLANT_DIR))))
    config = InvestigatorConfig(
        plant_id=pack.manifest.id,
        interval_s=float(optional("INVESTIGATOR_INTERVAL_S", "5")),
        max_steps=int(optional("INVESTIGATOR_MAX_STEPS", "12")),
    )
    wonder = WonderClient(
        meta_key(),
        base_url=optional("META_BASE_URL", DEFAULT_BASE_URL),
        model=optional("WONDER_MODEL", DEFAULT_MODEL),
    )
    pool = create_pool(require("DATABASE_URL"))
    await pool.open()
    investigator = Investigator(
        pack, TelemetryRepository(pool), InvestigationRepository(pool),
        RunRepository(pool), wonder, config,
    )
    log = logging.getLogger("investigator")
    log.info("investigating %s every %.0fs via %s", config.plant_id, config.interval_s, wonder.model)
    try:
        while True:
            try:
                await investigator.tick()
            except Exception:
                log.exception("tick failed")
            await asyncio.sleep(config.interval_s)
    finally:
        await wonder.aclose()
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())

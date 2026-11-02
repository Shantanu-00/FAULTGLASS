"""Run the deterministic incident verifier: python -m app.verifier."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from ..db import create_pool
from ..env import optional, require
from ..plant import load_pack
from ..repositories.investigation import InvestigationRepository
from ..repositories.runs import RunRepository
from ..repositories.telemetry import TelemetryRepository
from ..watcher.__main__ import load_repo_env
from .worker import IncidentVerifier, VerifierConfig

DEFAULT_PLANT_DIR = Path(__file__).resolve().parents[3] / "plants" / "waterplant"


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    load_repo_env()
    pack = load_pack(Path(optional("PLANT_DIR", str(DEFAULT_PLANT_DIR))))
    config = VerifierConfig(
        plant_id=pack.manifest.id,
        interval_s=float(optional("VERIFIER_INTERVAL_S", "5")),
    )
    pool = create_pool(require("DATABASE_URL"))
    await pool.open()
    verifier = IncidentVerifier(
        pack, TelemetryRepository(pool), InvestigationRepository(pool), RunRepository(pool), config)
    log = logging.getLogger("verifier")
    log.info("verifying executed actions for %s every %.0fs", config.plant_id, config.interval_s)
    try:
        while True:
            try:
                await verifier.tick()
            except Exception:
                log.exception("tick failed")
            await asyncio.sleep(config.interval_s)
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())

"""Run the Spark watcher:  python -m app.watcher

Reads telemetry from Postgres (DATABASE_URL), calls Baseten Muse Spark Open
(BASETEN_API_KEY, hackathon slug meta-models/muse-spark-open-1026), and writes
signal_flags / incidents. The key is read from the environment only; it is
never logged. For local runs the repo-root .env is loaded if present.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from ..db import create_pool
from ..env import optional, require
from ..observability import configure_event_logging
from ..plant import load_pack
from ..repositories.flags import FlagRepository
from ..repositories.runs import RunRepository
from ..repositories.telemetry import TelemetryRepository
from .spark import BasetenSparkClient, DEFAULT_BASE_URL, DEFAULT_MODEL, SparkError
from .worker import SparkWatcher, WatcherConfig

DEFAULT_PLANT_DIR = Path(__file__).resolve().parents[3] / "plants" / "waterplant"
REPO_ENV = Path(__file__).resolve().parents[3] / ".env"


def load_repo_env() -> None:
    """Minimal .env loader (KEY=VALUE per line); real environment wins."""
    if not REPO_ENV.exists():
        return
    for line in REPO_ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def baseten_key() -> str:
    # BASETEN_API_KEY is the Baseten-documented name; BASETEN_API is accepted
    # as an alias because the hackathon key was saved under that name locally.
    key = os.environ.get("BASETEN_API_KEY") or os.environ.get("BASETEN_API")
    if not key:
        raise SystemExit("BASETEN_API_KEY is required (see .env.example)")
    return key


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    configure_event_logging("watcher")
    load_repo_env()
    pack = load_pack(Path(optional("PLANT_DIR", str(DEFAULT_PLANT_DIR))))
    config = WatcherConfig(
        plant_id=pack.manifest.id,
        interval_s=float(optional("SPARK_INTERVAL_S", "10")),
    )
    spark = BasetenSparkClient(
        baseten_key(),
        base_url=optional("BASETEN_BASE_URL", DEFAULT_BASE_URL),
        model=optional("BASETEN_MODEL", DEFAULT_MODEL),
    )
    pool = create_pool(require("DATABASE_URL"))
    await pool.open()
    watcher = SparkWatcher(
        RunRepository(pool),
        TelemetryRepository(pool),
        FlagRepository(pool),
        spark,
        pack.instruments,
        config,
    )
    log = logging.getLogger("watcher")
    log.info("watching %s every %.0fs via %s", config.plant_id, config.interval_s, spark.model)
    try:
        while True:
            try:
                status = await watcher.tick()
                log.debug("tick: %s", status)
            except SparkError as exc:
                log.warning("spark unavailable: %s", exc)
            except Exception:
                log.exception("tick failed")
            await asyncio.sleep(config.interval_s)
    finally:
        await spark.aclose()
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())

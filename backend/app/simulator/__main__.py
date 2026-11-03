from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from ..db import create_pool
from ..env import optional, require
from ..plant import load_pack
from ..plant.registers import build_plan
from ..repositories.runs import RunRepository
from .plc import PlcServer
from .runner import SimulatorConfig, SimulatorRunner

DEFAULT_PLANT_DIR = Path(__file__).resolve().parents[3] / "plants" / "waterplant"


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    logging.getLogger("pymodbus").setLevel(logging.WARNING)
    pack = load_pack(Path(optional("PLANT_DIR", str(DEFAULT_PLANT_DIR))))
    source = next(s for s in pack.sources if s.protocol == "modbus_tcp")
    plan = build_plan(pack, source.id)
    config = SimulatorConfig(
        plant_id=pack.manifest.id,
        baseline_s=float(optional("SIM_BASELINE_S", "120")),
        heartbeat_timeout_s=float(optional("SIM_HEARTBEAT_TIMEOUT_S", "180")),
    )
    pool = create_pool(require("DATABASE_URL"))
    await pool.open()
    plc = PlcServer(plan, optional("MODBUS_BIND", "127.0.0.1"), int(optional("MODBUS_PORT", "5020")))
    await plc.start()
    runner = SimulatorRunner(RunRepository(pool), pack.instruments, plc, config)
    try:
        await runner.run_forever()
    finally:
        await plc.stop()
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())

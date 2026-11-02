from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import httpx

from ..env import optional, require
from ..plant import load_pack
from ..plant.registers import build_plan
from .agent import AgentConfig, EdgeAgent
from .buffer import OutboxBuffer
from .poller import ModbusPoller
from .uplink import Uplink

VERSION = "0.1.0"
DEFAULT_PLANT_DIR = Path(__file__).resolve().parents[3] / "plants" / "waterplant"


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    logging.getLogger("pymodbus").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    pack = load_pack(Path(optional("PLANT_DIR", str(DEFAULT_PLANT_DIR))))
    source = next(s for s in pack.sources if s.protocol == "modbus_tcp")
    plan = build_plan(pack, source.id)
    host = optional("MODBUS_HOST", str(source.endpoint.get("host", "127.0.0.1")))
    port = int(optional("MODBUS_PORT", str(source.endpoint.get("port", 502))))
    client = httpx.AsyncClient(
        base_url=require("API_URL"),
        headers={"Authorization": f"Bearer {require('EDGE_API_KEY')}", "X-Edge-Node": require("EDGE_NODE_ID")},
        timeout=10.0,
    )
    config = AgentConfig(
        poll_interval_s=float(source.poll_interval_s or 1.0),
        always_on=optional("EDGE_MODE", "session") == "continuous",
    )
    agent = EdgeAgent(
        ModbusPoller(plan, host, port),
        OutboxBuffer(optional("EDGE_BUFFER_PATH", "edge_outbox.db")),
        Uplink(client, version=VERSION),
        config,
    )
    try:
        await agent.run_forever()
    finally:
        await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())

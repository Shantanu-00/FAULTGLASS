from __future__ import annotations

import asyncio
import json
import time
from typing import AsyncIterator

from fastapi.encoders import jsonable_encoder

from ..repositories.telemetry import TelemetryRepository


def format_event(cursor: int, rows: list[dict]) -> str:
    return f"id: {cursor}\nevent: telemetry\ndata: {json.dumps(jsonable_encoder(rows))}\n\n"


async def telemetry_events(
    repo: TelemetryRepository,
    plant_id: str,
    cursor: int,
    *,
    poll_s: float = 1.0,
    keepalive_s: float = 15.0,
) -> AsyncIterator[str]:
    last_sent = time.monotonic()
    while True:
        rows = await repo.after_cursor(plant_id, cursor)
        if rows:
            cursor = rows[-1]["ingest_id"]
            last_sent = time.monotonic()
            yield format_event(cursor, rows)
            continue
        if time.monotonic() - last_sent >= keepalive_s:
            last_sent = time.monotonic()
            yield ": keepalive\n\n"
        await asyncio.sleep(poll_s)

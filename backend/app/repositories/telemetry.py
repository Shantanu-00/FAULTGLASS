from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool


@dataclass(frozen=True)
class Reading:
    tag: str
    observed_at: dt.datetime
    value: float | None
    raw_value: float | None
    unit: str
    quality: str
    source_id: str | None


INSERT_READING = """
insert into telemetry
  (plant_id, tag, observed_at, value, raw_value, unit, quality, provenance, source_id,
   edge_node_id, release_id, run_id)
values (%s, %s, %s, %s, %s, %s, %s, 'edge', %s, %s, %s, %s)
on conflict (plant_id, tag, observed_at) do nothing
"""

LATEST = """
select l.tag, l.value, l.unit, l.quality, l.observed_at, l.received_at, l.ingest_id, t.run_id
from telemetry_latest l
join telemetry t on t.plant_id = l.plant_id and t.tag = l.tag and t.observed_at = l.observed_at
where l.plant_id = %s
order by l.tag
"""


class TelemetryRepository:
    def __init__(self, pool: AsyncConnectionPool):
        self._pool = pool

    async def insert_readings(
        self,
        plant_id: str,
        readings: list[Reading],
        *,
        edge_node_id: str,
        release_id: UUID | None,
        run_id: UUID | None,
    ) -> int:
        if not readings:
            return 0
        rows = [
            (plant_id, r.tag, r.observed_at, r.value, r.raw_value, r.unit, r.quality, r.source_id,
             edge_node_id, release_id, run_id)
            for r in readings
        ]
        async with self._pool.connection() as conn:
            async with conn.transaction():
                cur = conn.cursor()
                await cur.executemany(INSERT_READING, rows)
                inserted = cur.rowcount
        return max(inserted, 0)

    async def latest(self, plant_id: str) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(LATEST, (plant_id,))
            return await cur.fetchall()

    async def history(self, plant_id: str, tag: str, since: dt.datetime, limit: int) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                select observed_at, value, quality from (
                  select observed_at, value, quality from telemetry
                  where plant_id = %s and tag = %s and observed_at >= %s
                  order by observed_at desc limit %s
                ) recent order by observed_at
                """,
                (plant_id, tag, since, limit),
            )
            return await cur.fetchall()

    async def after_cursor(self, plant_id: str, cursor: int, limit: int = 500) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                select ingest_id, tag, observed_at, value, unit, quality, run_id from telemetry
                where plant_id = %s and ingest_id > %s order by ingest_id limit %s
                """,
                (plant_id, cursor, limit),
            )
            return await cur.fetchall()

    async def head_cursor(self, plant_id: str) -> int:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select coalesce(max(ingest_id), 0) as head from telemetry where plant_id = %s", (plant_id,)
            )
            return (await cur.fetchone())["head"]

    async def release_id(self, plant_id: str) -> UUID | None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select id from plant_releases where plant_id = %s order by published_at desc limit 1", (plant_id,)
            )
            row = await cur.fetchone()
        return row["id"] if row else None

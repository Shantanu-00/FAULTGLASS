from __future__ import annotations

from typing import Any

from psycopg_pool import AsyncConnectionPool


class FlagRepository:
    def __init__(self, pool: AsyncConnectionPool):
        self._pool = pool

    async def recent(self, plant_id: str, limit: int = 50) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                select id, run_id, raised_at, status, severity, tags, summary, model, incident_id
                from signal_flags where plant_id = %s order by raised_at desc limit %s
                """,
                (plant_id, limit),
            )
            return await cur.fetchall()

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

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

    async def open_flag_for(self, run_id: UUID, tags: list[str]) -> dict[str, Any] | None:
        """An unresolved flag for the same run and tag set, if one is already open."""
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                select id, run_id, raised_at, status, severity, tags, summary, model, incident_id
                from signal_flags
                where run_id = %s and tags = %s and status in ('open', 'picked_up')
                order by raised_at desc limit 1
                """,
                (run_id, tags),
            )
            return await cur.fetchone()

    async def create(
        self,
        plant_id: str,
        *,
        run_id: UUID | None,
        severity: str,
        tags: list[str],
        summary: str,
        evidence: dict[str, Any],
        model: str | None,
        model_latency_ms: int | None,
        incident_id: str | None,
    ) -> dict[str, Any]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                insert into signal_flags
                  (plant_id, run_id, severity, tags, summary, evidence, model, model_latency_ms, incident_id)
                values (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)
                returning id, run_id, raised_at, status, severity, tags, summary, model, incident_id
                """,
                (plant_id, run_id, severity, tags, summary, json.dumps(evidence), model, model_latency_ms, incident_id),
            )
            return await cur.fetchone()

    async def ensure_incident(
        self,
        plant_id: str,
        incident_id: str,
        *,
        title: str,
        severity: str,
        symptoms: list[dict[str, Any]],
        models_used: list[str],
    ) -> str:
        """Open the live incident a FLAG starts; idempotent per incident_id."""
        async with self._pool.connection() as conn:
            await conn.execute(
                """
                insert into incidents
                  (incident_id, plant_id, title, status, severity, opened_at, symptoms, data_origin, models_used)
                values (%s, %s, %s, 'open', %s, now(), %s::jsonb, 'live', %s)
                on conflict (incident_id) do nothing
                """,
                (incident_id, plant_id, title, severity, json.dumps(symptoms), models_used),
            )
        return incident_id

    async def add_trace(
        self,
        incident_id: str,
        *,
        kind: str,
        actor: str,
        content: str,
        evidence: list[Any],
        tool_name: str | None = None,
    ) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                """
                insert into incident_trace (incident_id, seq, at, kind, actor, tool_name, content, evidence)
                select %s, coalesce(max(seq), 0) + 1, now(), %s, %s, %s, %s, %s::jsonb
                from incident_trace where incident_id = %s
                """,
                (incident_id, kind, actor, tool_name, content, json.dumps(evidence), incident_id),
            )

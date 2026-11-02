from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool


class InvestigationRepository:
    def __init__(self, pool: AsyncConnectionPool):
        self._pool = pool

    # ---- incidents -------------------------------------------------------
    async def open_live_incidents(self, plant_id: str) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                select i.incident_id, i.title, i.severity, i.opened_at, i.symptoms,
                       c.status as investigation_status
                from incidents i
                left join investigation_checkpoints c on c.incident_id = i.incident_id
                where i.plant_id = %s and i.status = 'open' and i.data_origin = 'live'
                  and (c.status is null or c.status = 'investigating')
                order by i.opened_at
                """,
                (plant_id,),
            )
            return await cur.fetchall()

    async def live_incidents(self, plant_id: str, limit: int = 20) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                select i.incident_id, i.title, i.status, i.severity, i.opened_at, i.symptoms, i.models_used,
                       c.status as investigation_status, c.focus, c.steps_used,
                       (select count(*) from incident_hypotheses h where h.incident_id = i.incident_id) as hypotheses,
                       (select count(*) from field_tasks t
                         where t.incident_id = i.incident_id and t.status = 'pending') as pending_tasks
                from incidents i
                left join investigation_checkpoints c on c.incident_id = i.incident_id
                where i.plant_id = %s and i.data_origin = 'live'
                order by i.opened_at desc limit %s
                """,
                (plant_id, limit),
            )
            return await cur.fetchall()

    async def incident(self, incident_id: str) -> dict[str, Any] | None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select * from incidents where incident_id = %s", (incident_id,)
            )
            return await cur.fetchone()

    async def pick_up_flag(self, incident_id: str) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                "update signal_flags set status = 'picked_up' where incident_id = %s and status = 'open'",
                (incident_id,),
            )

    async def flag_for_incident(self, incident_id: str) -> dict[str, Any] | None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                select id, run_id, raised_at, severity, tags, summary, evidence, model
                from signal_flags where incident_id = %s order by raised_at limit 1
                """,
                (incident_id,),
            )
            return await cur.fetchone()

    async def trace(self, incident_id: str) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select seq, at, kind, actor, hypothesis_id, tool_name, content, evidence "
                "from incident_trace where incident_id = %s order by seq",
                (incident_id,),
            )
            return await cur.fetchall()

    async def add_trace(self, incident_id: str, *, kind: str, actor: str, content: str,
                        evidence: list[Any] | None = None, tool_name: str | None = None,
                        hypothesis_id: str | None = None) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                """
                insert into incident_trace (incident_id, seq, at, kind, actor, hypothesis_id, tool_name, content, evidence)
                select %s, coalesce(max(seq), 0) + 1, now(), %s, %s, %s, %s, %s, %s::jsonb
                from incident_trace where incident_id = %s
                """,
                (incident_id, kind, actor, hypothesis_id, tool_name, content,
                 json.dumps(evidence or []), incident_id),
            )

    # ---- hypotheses ------------------------------------------------------
    async def upsert_hypothesis(self, incident_id: str, label: str, statement: str, status: str,
                                evidence_for: list[Any], evidence_against: list[Any]) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                """
                insert into incident_hypotheses
                  (incident_id, label, statement, status, evidence_for, evidence_against)
                values (%s, %s, %s, %s, %s::jsonb, %s::jsonb)
                on conflict (incident_id, label) do update
                  set statement = excluded.statement, status = excluded.status,
                      evidence_for = excluded.evidence_for,
                      evidence_against = excluded.evidence_against, updated_at = now()
                """,
                (incident_id, label, statement, status, json.dumps(evidence_for), json.dumps(evidence_against)),
            )

    async def hypotheses(self, incident_id: str) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select label, statement, status, evidence_for, evidence_against, updated_at "
                "from incident_hypotheses where incident_id = %s order by label",
                (incident_id,),
            )
            return await cur.fetchall()

    # ---- field tasks -----------------------------------------------------
    async def create_field_task(self, incident_id: str, *, kind: str, asset_ids: list[str],
                                tags: list[str], instruction: str) -> dict[str, Any]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                insert into field_tasks (incident_id, kind, asset_ids, tags, instruction)
                values (%s, %s, %s, %s, %s)
                returning id, incident_id, kind, asset_ids, tags, instruction, status, created_at
                """,
                (incident_id, kind, asset_ids, tags, instruction),
            )
            return await cur.fetchone()

    async def field_tasks(self, incident_id: str) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select id, kind, asset_ids, tags, instruction, status, result, created_at, completed_at "
                "from field_tasks where incident_id = %s order by created_at",
                (incident_id,),
            )
            return await cur.fetchall()

    async def pending_field_task(self, incident_id: str) -> dict[str, Any] | None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select id, kind, asset_ids, tags, instruction, status from field_tasks "
                "where incident_id = %s and status = 'pending' order by created_at limit 1",
                (incident_id,),
            )
            return await cur.fetchone()

    async def unconsumed_results(self, incident_id: str) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select id, kind, asset_ids, tags, result from field_tasks "
                "where incident_id = %s and status = 'completed' and not consumed order by completed_at",
                (incident_id,),
            )
            return await cur.fetchall()

    async def complete_field_task(self, task_id: UUID, result: dict[str, Any]) -> bool:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "update field_tasks set status = 'completed', result = %s::jsonb, completed_at = now() "
                "where id = %s and status = 'pending'",
                (json.dumps(result), task_id),
            )
            return cur.rowcount == 1

    async def mark_consumed(self, task_id: UUID) -> None:
        async with self._pool.connection() as conn:
            await conn.execute("update field_tasks set consumed = true where id = %s", (task_id,))

    # ---- checkpoint ------------------------------------------------------
    async def checkpoint(self, incident_id: str) -> dict[str, Any] | None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select incident_id, status, revision, steps_used, continuation, focus, model "
                "from investigation_checkpoints where incident_id = %s",
                (incident_id,),
            )
            return await cur.fetchone()

    async def save_checkpoint(self, incident_id: str, *, status: str, steps_used: int,
                              continuation: list[Any], focus: dict[str, Any], model: str | None) -> int:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                insert into investigation_checkpoints
                  (incident_id, status, revision, steps_used, continuation, focus, model, updated_at)
                values (%s, %s, 1, %s, %s::jsonb, %s::jsonb, %s, now())
                on conflict (incident_id) do update
                  set status = excluded.status, revision = investigation_checkpoints.revision + 1,
                      steps_used = excluded.steps_used, continuation = excluded.continuation,
                      focus = excluded.focus, model = excluded.model, updated_at = now()
                returning revision
                """,
                (incident_id, status, steps_used, json.dumps(continuation), json.dumps(focus), model),
            )
            return (await cur.fetchone())["revision"]

    async def memory_blocks(self, plant_id: str) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select kind, title, body_md from plant_memory where plant_id = %s order by kind", (plant_id,)
            )
            return await cur.fetchall()

    async def sops(self) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select sop_id, title, applies_to, triggers, steps, body_md from sops order by sop_id"
            )
            return await cur.fetchall()

    async def past_incidents(self, plant_id: str, exclude_id: str) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                select incident_id, title, symptoms, root_cause, resolution, sops_used, lessons, opened_at
                from incidents
                where plant_id = %s and data_origin = 'synthetic' and incident_id <> %s
                order by opened_at desc
                """,
                (plant_id, exclude_id),
            )
            return await cur.fetchall()

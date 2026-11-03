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

    # ---- action proposals --------------------------------------------------
    async def create_proposal(self, incident_id: str, *, asset_id: str, action: str,
                              rationale: str, sop_id: str | None) -> dict[str, Any]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                insert into action_proposals (incident_id, asset_id, action, rationale, sop_id)
                values (%s, %s, %s, %s, %s)
                returning id, incident_id, asset_id, action, rationale, sop_id, status,
                          field_task_id, result, created_at, approved_at, executed_at
                """,
                (incident_id, asset_id, action, rationale, sop_id),
            )
            return await cur.fetchone()

    async def proposals(self, incident_id: str) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select id, incident_id, asset_id, action, rationale, sop_id, status, field_task_id, "
                "result, created_at, approved_at, executed_at from action_proposals "
                "where incident_id = %s order by created_at",
                (incident_id,),
            )
            return await cur.fetchall()

    async def proposal(self, proposal_id: UUID) -> dict[str, Any] | None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select id, incident_id, asset_id, action, rationale, sop_id, status, field_task_id, "
                "result, created_at, approved_at, executed_at from action_proposals where id = %s",
                (proposal_id,),
            )
            return await cur.fetchone()

    async def proposal_for_task(self, task_id: UUID) -> dict[str, Any] | None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select id, incident_id, asset_id, action, rationale, sop_id, status, field_task_id, "
                "result, created_at, approved_at, executed_at from action_proposals where field_task_id = %s",
                (task_id,),
            )
            return await cur.fetchone()

    async def approve_proposal(self, proposal_id: UUID, task_id: UUID) -> bool:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "update action_proposals set status = 'approved', field_task_id = %s, approved_at = now() "
                "where id = %s and status = 'pending'",
                (task_id, proposal_id),
            )
            return cur.rowcount == 1

    async def set_proposal_status(self, proposal_id: UUID, status: str, *,
                                  result: dict[str, Any] | None = None) -> bool:
        executed = ", executed_at = now()" if status == "executed" else ""
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                f"update action_proposals set status = %s, result = %s::jsonb{executed} where id = %s",
                (status, json.dumps(result or {}), proposal_id),
            )
            return cur.rowcount == 1

    async def executed_proposals(self) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select id, incident_id, asset_id, action, rationale, sop_id, status, field_task_id, "
                "result, created_at, approved_at, executed_at from action_proposals "
                "where status = 'executed' order by executed_at"
            )
            return await cur.fetchall()

    async def resolve_incident(self, incident_id: str, *, root_cause: str, resolution: str) -> bool:
        async with self._pool.connection() as conn:
            async with conn.transaction():
                cur = await conn.execute(
                    "update incidents set status = 'resolved', closed_at = now(), closed_by = 'verifier', "
                    "root_cause = %s, resolution = %s where incident_id = %s and status = 'open'",
                    (root_cause, resolution, incident_id),
                )
                changed = cur.rowcount == 1
                if changed:
                    await conn.execute(
                        "update signal_flags set status = 'resolved' "
                        "where incident_id = %s and status in ('open', 'picked_up')",
                        (incident_id,),
                    )
            return changed

    async def abandon_open_work(self, plant_id: str) -> list[str]:
        """Close every live incident and everything waiting on it; used when a run is replaced."""
        async with self._pool.connection() as conn:
            async with conn.transaction():
                cur = await conn.execute(
                    "update incidents set status = 'closed', closed_at = now(), closed_by = 'operator', "
                    "resolution = 'Run reset by the operator.' "
                    "where plant_id = %s and data_origin = 'live' and status = 'open' returning incident_id",
                    (plant_id,),
                )
                ids = [row["incident_id"] for row in await cur.fetchall()]
                await conn.execute(
                    "update signal_flags set status = 'dismissed' "
                    "where plant_id = %s and status in ('open', 'picked_up')",
                    (plant_id,),
                )
                if ids:
                    await conn.execute(
                        "update field_tasks set status = 'cancelled' "
                        "where incident_id = any(%s) and status = 'pending'", (ids,))
                    await conn.execute(
                        "update action_proposals set status = 'rejected' "
                        "where incident_id = any(%s) and status in ('pending', 'approved')", (ids,))
            return ids

    # ---- voice observations -------------------------------------------------
    async def create_voice_observation(
        self, incident_id: str, *, task_id: UUID | None, transcript: str,
        language_bias: list[str], structured: dict[str, Any], comparison: dict[str, Any],
        audio_sha256: str, audio_path: str, model: str,
    ) -> dict[str, Any]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                insert into voice_observations
                  (incident_id, task_id, transcript, language_bias, structured, comparison,
                   audio_sha256, audio_path, model)
                values (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s)
                returning id, incident_id, task_id, transcript, language_bias,
                          structured, comparison, created_at
                """,
                (incident_id, task_id, transcript, language_bias, json.dumps(structured),
                 json.dumps(comparison), audio_sha256, audio_path, model),
            )
            return await cur.fetchone()

    async def voice_observations(self, incident_id: str) -> list[dict[str, Any]]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select id, incident_id, task_id, transcript, language_bias, structured, comparison, model, created_at, audio_path, audio_sha256 "
                "from voice_observations where incident_id = %s order by created_at",
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
                "update field_tasks set status = 'completed', result = %s::jsonb || "
                "jsonb_build_object('_media', coalesce(result->'_media', '[]'::jsonb)), completed_at = now() "
                "where id = %s and status = 'pending'",
                (json.dumps(result), task_id),
            )
            return cur.rowcount == 1

    async def save_task_progress(self, task_id: UUID, result: dict[str, Any]) -> bool:
        """Keep partial evidence on a task that is still pending (for example one of two gauges read)."""
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "update field_tasks set result = %s::jsonb || "
                "jsonb_build_object('_media', coalesce(result->'_media', '[]'::jsonb)) "
                "where id = %s and status = 'pending'",
                (json.dumps(result), task_id),
            )
            return cur.rowcount == 1

    async def append_task_media(self, task_id: UUID, records: list[dict[str, Any]]) -> None:
        """Retain submitted files before analysis, including unsuccessful or partial attempts."""
        async with self._pool.connection() as conn:
            await conn.execute(
                "update field_tasks set result = jsonb_set(coalesce(result, '{}'::jsonb), '{_media}', "
                "coalesce(result->'_media', '[]'::jsonb) || %s::jsonb) where id = %s",
                (json.dumps(records), task_id),
            )

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

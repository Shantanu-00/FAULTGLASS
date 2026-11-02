from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import psycopg.errors
from psycopg_pool import AsyncConnectionPool

RUN_COLUMNS = """
    id, plant_id, status, seed, clock_speed, scenario, scenario_started_at, started_at,
    baseline_ready_at, extract(epoch from now() - last_heartbeat_at) as heartbeat_age_s
"""


class ActiveRunExists(Exception):
    pass


@dataclass(frozen=True)
class SimRun:
    id: UUID
    plant_id: str
    status: str
    seed: int
    clock_speed: float
    scenario: str | None
    scenario_started_at: dt.datetime | None
    started_at: dt.datetime
    baseline_ready_at: dt.datetime | None
    heartbeat_age_s: float

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> SimRun:
        return cls(**{**row, "heartbeat_age_s": float(row["heartbeat_age_s"])})

    def to_json(self) -> dict[str, Any]:
        return {
            "id": str(self.id),
            "plant_id": self.plant_id,
            "status": self.status,
            "clock_speed": self.clock_speed,
            "scenario": self.scenario,
            "scenario_started_at": self.scenario_started_at.isoformat() if self.scenario_started_at else None,
            "started_at": self.started_at.isoformat(),
            "baseline_ready_at": self.baseline_ready_at.isoformat() if self.baseline_ready_at else None,
        }


@dataclass(frozen=True)
class SimEvent:
    id: int
    run_id: UUID
    at: dt.datetime
    kind: str
    payload: dict[str, Any]


class RunRepository:
    def __init__(self, pool: AsyncConnectionPool):
        self._pool = pool

    async def create(self, plant_id: str, *, seed: int, clock_speed: float = 1.0) -> SimRun:
        try:
            async with self._pool.connection() as conn:
                cur = await conn.execute(
                    f"insert into sim_runs (plant_id, seed, clock_speed) values (%s, %s, %s) returning {RUN_COLUMNS}",
                    (plant_id, seed, clock_speed),
                )
                return SimRun.from_row(await cur.fetchone())
        except psycopg.errors.UniqueViolation as exc:
            raise ActiveRunExists(plant_id) from exc

    async def active(self, plant_id: str) -> SimRun | None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                f"select {RUN_COLUMNS} from sim_runs where plant_id = %s and status <> 'stopped'", (plant_id,)
            )
            row = await cur.fetchone()
        return SimRun.from_row(row) if row else None

    async def get(self, run_id: UUID) -> SimRun | None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(f"select {RUN_COLUMNS} from sim_runs where id = %s", (run_id,))
            row = await cur.fetchone()
        return SimRun.from_row(row) if row else None

    async def heartbeat(self, run_id: UUID) -> bool:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "update sim_runs set last_heartbeat_at = now() where id = %s and status <> 'stopped'", (run_id,)
            )
            return cur.rowcount == 1

    async def add_event(self, run_id: UUID, kind: str, payload: dict[str, Any]) -> SimEvent | None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                """
                insert into sim_events (run_id, kind, payload)
                select id, %s, %s::jsonb from sim_runs where id = %s and status <> 'stopped'
                returning id, run_id, at, kind, payload
                """,
                (kind, json.dumps(payload), run_id),
            )
            row = await cur.fetchone()
        return SimEvent(**row) if row else None

    async def events_after(self, run_id: UUID, after_id: int) -> list[SimEvent]:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select id, run_id, at, kind, payload from sim_events where run_id = %s and id > %s order by id",
                (run_id, after_id),
            )
            return [SimEvent(**r) for r in await cur.fetchall()]

    async def mark_learning(self, run_id: UUID) -> None:
        async with self._pool.connection() as conn:
            await conn.execute("update sim_runs set status = 'learning' where id = %s and status = 'starting'", (run_id,))

    async def mark_running(self, run_id: UUID) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                "update sim_runs set status = 'running', baseline_ready_at = now() where id = %s and status = 'learning'",
                (run_id,),
            )

    async def set_scenario(self, run_id: UUID, scenario: str | None) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                "update sim_runs set scenario = %s, scenario_started_at = now() where id = %s", (scenario, run_id)
            )

    async def stop(self, run_id: UUID, reason: str) -> bool:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "update sim_runs set status = 'stopped', stopped_at = now(), stop_reason = %s "
                "where id = %s and status <> 'stopped'",
                (reason, run_id),
            )
            return cur.rowcount == 1

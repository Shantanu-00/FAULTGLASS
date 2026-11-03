from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Callable, Protocol
from uuid import UUID

from ..plant.models import Instrument
from ..repositories.runs import RunRepository, SimEvent, SimRun
from .model import PlantModel

log = logging.getLogger("simulator")

SCENARIO_PRODUCTION_DECLINE = "production_decline"
ACTION_BACKWASH_COMPLETED = "backwash_completed"


class Publisher(Protocol):
    def publish(self, values: dict[str, float]) -> None: ...


@dataclass(frozen=True)
class SimulatorConfig:
    plant_id: str
    baseline_s: float = 120.0
    tick_s: float = 0.5
    heartbeat_timeout_s: float = 180.0


@dataclass
class Session:
    run_id: UUID
    model: PlantModel
    last_tick: float
    cursor: int = 0
    elapsed: float = 0.0


class SimulatorRunner:
    def __init__(
        self,
        runs: RunRepository,
        instruments: list[Instrument],
        plc: Publisher,
        config: SimulatorConfig,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._runs = runs
        self._instruments = instruments
        self._plc = plc
        self._config = config
        self._clock = clock
        self._session: Session | None = None
        self._idle = PlantModel(instruments, seed=0)
        self._idle_tick = clock()

    async def run_forever(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("tick failed")
            await asyncio.sleep(self._config.tick_s)

    async def tick(self) -> None:
        now = self._clock()
        run = await self._runs.active(self._config.plant_id)
        if run is None:
            self._session = None
            self._advance_idle(now)
            return
        if self._session is None or self._session.run_id != run.id:
            self._session = Session(run.id, PlantModel(self._instruments, run.seed), last_tick=now)
            log.info("run %s picked up", run.id)
        session = self._session
        if run.heartbeat_age_s > self._config.heartbeat_timeout_s:
            await self._runs.stop(run.id, "heartbeat_lost")
            self._session = None
            log.info("run %s stopped: no heartbeat", run.id)
            return
        if run.status == "starting":
            await self._runs.mark_learning(run.id)
        for event in await self._runs.events_after(run.id, session.cursor):
            session.cursor = event.id
            await self._apply(run, session, event)
        dt = max(0.0, now - session.last_tick) * run.clock_speed
        session.last_tick = now
        session.model.step(dt)
        session.elapsed += dt
        if run.status in ("starting", "learning") and session.elapsed >= self._config.baseline_s:
            await self._runs.mark_running(run.id)
        self._plc.publish(session.model.readings())

    async def _apply(self, run: SimRun, session: Session, event: SimEvent) -> None:
        if run.status != "running":
            log.info("event %s ignored while %s", event.id, run.status)
            return
        if event.kind == "scenario" and event.payload.get("name") == SCENARIO_PRODUCTION_DECLINE:
            session.model.start_decline()
            await self._runs.set_scenario(run.id, SCENARIO_PRODUCTION_DECLINE)
        elif event.kind == "valve_action" and event.payload.get("action") == ACTION_BACKWASH_COMPLETED:
            if session.model.begin_recovery():
                log.info("run %s recovering", run.id)
        else:
            log.warning("event %s not understood: %s %s", event.id, event.kind, event.payload)

    def _advance_idle(self, now: float) -> None:
        self._idle.step(max(0.0, now - self._idle_tick))
        self._idle_tick = now
        self._plc.publish(self._idle.readings())

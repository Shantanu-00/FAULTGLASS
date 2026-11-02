from __future__ import annotations

import datetime as dt
import logging
from typing import Callable

from pymodbus.client import AsyncModbusTcpClient

from ..plant.registers import RegisterPlan, RegisterPoint
from .observation import Observation

log = logging.getLogger("edge.poller")

Clock = Callable[[], dt.datetime]


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class ModbusPoller:
    def __init__(self, plan: RegisterPlan, host: str, port: int, *, timeout_s: float = 2.0, clock: Clock = utcnow):
        self._plan = plan
        self._clock = clock
        self._client = AsyncModbusTcpClient(host, port=port, timeout=timeout_s, retries=1)

    async def poll(self) -> list[Observation]:
        observed_at = self._clock()
        results: list[Observation] = []
        for table, points in self._plan.tables().items():
            words = await self._read(table, self._plan.size(table))
            for point in points:
                results.append(self._observe(point, words, observed_at))
        return results

    async def close(self) -> None:
        self._client.close()

    async def _read(self, table: str, count: int) -> list[int] | None:
        try:
            if not self._client.connected:
                await self._client.connect()
            unit = self._plan.unit_id
            if table == "discrete":
                response = await self._client.read_discrete_inputs(0, count=count, device_id=unit)
            elif table == "input":
                response = await self._client.read_input_registers(0, count=count, device_id=unit)
            elif table == "holding":
                response = await self._client.read_holding_registers(0, count=count, device_id=unit)
            else:
                return None
            if response.isError():
                log.warning("%s read failed: %s", table, response)
                return None
            return [int(b) for b in response.bits[:count]] if table == "discrete" else list(response.registers)
        except Exception as exc:
            log.warning("%s read failed: %s", table, exc)
            self._client.close()
            return None

    @staticmethod
    def _observe(point: RegisterPoint, words: list[int] | None, observed_at: dt.datetime) -> Observation:
        if words is None or point.offset >= len(words):
            return Observation(point.tag, observed_at, None, None, point.unit, "bad")
        raw = words[point.offset]
        return Observation(point.tag, observed_at, point.decode(raw), float(raw), point.unit, "good")

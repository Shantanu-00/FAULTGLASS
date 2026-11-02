from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from .buffer import OutboxBuffer
from .poller import ModbusPoller
from .uplink import SendResult, Uplink

log = logging.getLogger("edge.agent")


@dataclass(frozen=True)
class AgentConfig:
    poll_interval_s: float = 1.0
    session_interval_s: float = 2.0
    flush_interval_s: float = 1.0
    batch_size: int = 200
    always_on: bool = False


class EdgeAgent:
    def __init__(self, poller: ModbusPoller, buffer: OutboxBuffer, uplink: Uplink, config: AgentConfig):
        self._poller = poller
        self._buffer = buffer
        self._uplink = uplink
        self._config = config
        self.run_id: str | None = None
        self.active = False

    async def refresh_session(self) -> None:
        session = await self._uplink.session()
        if self._config.always_on:
            self.active = True
            self.run_id = None
            return
        if session is None:
            return
        run = session.get("run")
        self.active = run is not None
        self.run_id = run["id"] if run else None

    async def poll_once(self) -> int:
        if not self.active:
            return 0
        observations = await self._poller.poll()
        self._buffer.add(self.run_id, observations)
        return len(observations)

    async def flush_once(self) -> int:
        sent = 0
        while (batch := self._buffer.next_batch(self._config.batch_size)) is not None:
            result = await self._uplink.send(batch)
            if result is SendResult.RETRY:
                break
            self._buffer.remove(batch.ids)
            if result is SendResult.SENT:
                sent += len(batch.ids)
        return sent

    async def run_forever(self) -> None:
        await asyncio.gather(
            self._loop(self.refresh_session, self._config.session_interval_s),
            self._loop(self.poll_once, self._config.poll_interval_s),
            self._loop(self.flush_once, self._config.flush_interval_s),
        )

    @staticmethod
    async def _loop(step, interval_s: float) -> None:
        while True:
            try:
                await step()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("%s failed", step.__name__)
            await asyncio.sleep(interval_s)

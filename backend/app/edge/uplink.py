from __future__ import annotations

import enum
import logging

import httpx

from .buffer import Batch

log = logging.getLogger("edge.uplink")


class SendResult(enum.Enum):
    SENT = "sent"
    RETRY = "retry"
    REJECTED = "rejected"


class Uplink:
    def __init__(self, client: httpx.AsyncClient, *, version: str):
        self._client = client
        self._version = version

    async def session(self) -> dict | None:
        try:
            response = await self._client.get("/v1/edge/session", headers={"X-Edge-Version": self._version})
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as exc:
            log.warning("session lookup failed: %s", exc)
            return None

    async def send(self, batch: Batch) -> SendResult:
        payload = {"run_id": batch.run_id, "readings": [o.to_json() for o in batch.observations]}
        try:
            response = await self._client.post("/v1/ingest/telemetry", json=payload)
        except httpx.HTTPError as exc:
            log.warning("ingest unreachable: %s", exc)
            return SendResult.RETRY
        if response.is_success:
            return SendResult.SENT
        if response.status_code in (401, 408, 429) or response.status_code >= 500:
            log.warning("ingest returned %s", response.status_code)
            return SendResult.RETRY
        log.error("ingest rejected a batch of %d readings: %s %s", len(batch.observations), response.status_code, response.text)
        return SendResult.REJECTED

    async def close(self) -> None:
        await self._client.aclose()

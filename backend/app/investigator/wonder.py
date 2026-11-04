"""Meta Muse Wonder client (Responses API, stateless encrypted replay).

Wonder is the lead investigator. Per docs/meta/protocols/responses.md the
Responses API is the only endpoint that carries reasoning between turns, so we
use it with `store: false` + `include: ["reasoning.encrypted_content"]` and
persist the returned items (including encrypted reasoning) in the incident
checkpoint, replaying them intact on the next turn. Encrypted items are
opaque: we never read, log, summarise, or rewrite them; we keep or drop whole
turns only.

The API key comes from MODEL_API_KEY (the Meta-documented name);
META_MODEL_API is accepted as a local alias. It is never logged or printed.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..observability import ModelCall

DEFAULT_BASE_URL = "https://api.meta.ai/v1"
DEFAULT_MODEL = "muse-wonder-1.0"


class WonderError(RuntimeError):
    pass


@dataclass(frozen=True)
class WonderReply:
    output: list[dict[str, Any]] = field(default_factory=list)
    latency_ms: int = 0
    usage: dict[str, Any] = field(default_factory=dict)
    model: str = DEFAULT_MODEL

    @property
    def function_calls(self) -> list[dict[str, Any]]:
        return [i for i in self.output if i.get("type") == "function_call"]

    @property
    def text(self) -> str:
        parts: list[str] = []
        for item in self.output:
            if item.get("type") == "message":
                for content in item.get("content", []):
                    if content.get("text"):
                        parts.append(content["text"])
        return "\n".join(parts).strip()


class WonderClient:
    """Minimal Responses-API client over httpx (OpenAI-compatible shape)."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        model: str = DEFAULT_MODEL,
        timeout_s: float = 180.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        if not api_key:
            raise WonderError("Meta Model API key is required (MODEL_API_KEY)")
        self._model = model
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=timeout_s,
            transport=transport,
        )

    @property
    def model(self) -> str:
        return self._model

    async def create(
        self,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        reasoning_effort: str = "medium",
    ) -> WonderReply:
        with ModelCall(provider="meta", model=self._model, operation="responses") as call:
            started = time.monotonic()
            try:
                response = await self._client.post(
                    "/responses",
                    json={
                        "model": self._model,
                        "input": input_items,
                        "tools": tools,
                        "reasoning": {"effort": reasoning_effort, "summary": "concise"},
                        "store": False,
                        "include": ["reasoning.encrypted_content"],
                        "max_output_tokens": 4096,
                    },
                )
            except httpx.HTTPError as exc:
                raise WonderError(f"Meta Model API request failed: {exc.__class__.__name__}") from exc
            latency_ms = int((time.monotonic() - started) * 1000)
            call.response(response)
            if response.status_code != 200:
                raise WonderError(f"Meta Model API returned HTTP {response.status_code}")
            try:
                data = response.json()
                output = data["output"]
            except (ValueError, KeyError, TypeError) as exc:
                raise WonderError("Meta Model API response had no output") from exc
            call.result(usage=data.get("usage"), output=output, tools=tools)
            return WonderReply(output=output, latency_ms=latency_ms, usage=data.get("usage") or {}, model=self._model)

    async def aclose(self) -> None:
        await self._client.aclose()

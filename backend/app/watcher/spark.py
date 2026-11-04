"""Baseten Muse Spark Open client and verdict parsing.

Baseten is OpenAI-compatible: POST {BASETEN_BASE_URL}/chat/completions with a
Bearer key and the hackathon model slug `meta-models/muse-spark-open-1026`
(the generic catalog slug is `meta-models/muse-spark-open`; the hackathon key
only works with the -1026 slug). Spark Open always reasons; Baseten returns that
reasoning separately in `reasoning_content`. We read only `content`, and we
never store or log `reasoning_content`.

Spark Open does not enforce structured outputs or JSON mode on Baseten, so the
contract is plain text, parsed and validated in Python (docs/ARCHITECTURE.md §7):

    FLAG
    <one-sentence summary citing the deviating tags, no diagnosis>
    TAGS: FIT-301, PIT-301
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass

import httpx

from ..observability import ModelCall
from .card import Card

DEFAULT_BASE_URL = "https://inference.baseten.co/v1"
DEFAULT_MODEL = "meta-models/muse-spark-open-1026"

SYSTEM_PROMPT = """You are the telemetry watcher for an industrial water plant.
You are given a summary card computed by code. You do not diagnose causes and you
do not invent values. Judge only whether the measurements have drifted from baseline.

Reply in exactly this plain-text format, nothing else:
First line: exactly one of NORMAL, WATCH, or FLAG
Second line: one short sentence (max 25 words) describing what moved, citing tag names. No causes, no advice.
Third line: TAGS: followed by a comma-separated list of the deviating tags from the card, or TAGS: none

Rules:
- NORMAL when every measurement is close to baseline.
- WATCH when one or more measurements are drifting but modestly.
- FLAG when production-relevant measurements have moved clearly and together.
- Only cite tags that appear on the card. Never cite a tag whose distance is small.
"""

_VERDICTS = ("FLAG", "WATCH", "NORMAL")


@dataclass(frozen=True)
class SparkReply:
    content: str
    latency_ms: int
    model: str


@dataclass(frozen=True)
class Verdict:
    verdict: str  # NORMAL | WATCH | FLAG
    summary: str
    tags: list[str]


class SparkError(RuntimeError):
    pass


class BasetenSparkClient:
    """Minimal OpenAI-compatible chat client for Baseten (httpx, no SDK needed)."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        model: str = DEFAULT_MODEL,
        timeout_s: float = 60.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        if not api_key:
            raise SparkError("Baseten API key is required (BASETEN_API_KEY)")
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

    async def classify(self, card_text: str) -> SparkReply:
        with ModelCall(provider="baseten", model=self._model, operation="chat.completions") as call:
            started = time.monotonic()
            try:
                response = await self._client.post(
                    "/chat/completions",
                    json={
                        "model": self._model,
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": card_text},
                        ],
                        # Spark Open always reasons; low keeps the 10 s watcher cheap.
                        # Baseten maps none/minimal to low for this model.
                        "reasoning_effort": "low",
                        "max_tokens": 1024,
                    },
                )
            except httpx.HTTPError as exc:
                raise SparkError(f"Baseten request failed: {exc.__class__.__name__}") from exc
            latency_ms = int((time.monotonic() - started) * 1000)
            call.response(response)
            if response.status_code != 200:
                raise SparkError(f"Baseten returned HTTP {response.status_code}")
            try:
                data = response.json()
                message = data["choices"][0]["message"]
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                raise SparkError("Baseten response had no choices[0].message") from exc
            content = (message.get("content") or "").strip()
            if not content:
                raise SparkError("Baseten returned empty content")
            call.result(usage=data.get("usage"))
            # message may also carry reasoning_content; it is deliberately ignored.
            return SparkReply(content=content, latency_ms=latency_ms, model=self._model)

    async def aclose(self) -> None:
        await self._client.aclose()


def parse_verdict(content: str, card: Card) -> Verdict:
    """Parse Spark's plain text and keep only tags that exist on the card."""
    lines = [ln.strip() for ln in content.strip().splitlines() if ln.strip()]
    if not lines:
        raise SparkError("empty Spark reply")
    verdict = lines[0].strip().upper().strip(".:* ")
    for candidate in _VERDICTS:
        if verdict.startswith(candidate):
            verdict = candidate
            break
    else:
        raise SparkError(f"unrecognised verdict line: {lines[0][:40]!r}")
    summary = lines[1] if len(lines) > 1 else ""
    summary = re.sub(r"^(summary|reason|detail)\s*:\s*", "", summary, flags=re.IGNORECASE).strip()
    if len(summary) > 300:
        summary = summary[:297].rstrip() + "..."
    tags: list[str] = []
    known = {s.tag for s in card.signals} | {s.tag for s in card.states}
    for line in lines:
        if line.upper().startswith("TAGS:"):
            raw = line.split(":", 1)[1]
            tags = [t.strip().strip("`[]") for t in raw.split(",") if t.strip() and t.strip().lower() != "none"]
            break
    if not tags:  # fall back to any known tag mentioned in the reply
        tags = [t for t in known if t in content]
    tags = [t for t in dict.fromkeys(tags) if t in known]
    if verdict != "NORMAL" and not summary:
        summary = f"{verdict}: " + ", ".join(tags) if tags else verdict
    return Verdict(verdict=verdict, summary=summary, tags=tags)


def check_against_card(verdict: Verdict, card: Card) -> tuple[list[str], str | None]:
    """Return (validated tags, severity) or ([], None) if code disagrees.

    A FLAG/WATCH is only persisted for tags whose deterministic gate on the card
    agrees, plus abnormal discrete states the model cited. This is the check in
    docs/DEMO.md: Python parses Spark's answer and checks it against the card.
    """
    if verdict.verdict == "NORMAL":
        return [], None
    by_tag = card.by_tag()
    states = {s.tag: s for s in card.states}
    validated: list[str] = []
    strongest = 0  # 0 none, 1 watch, 2 flag
    for tag in verdict.tags:
        signal = by_tag.get(tag)
        if signal is not None:
            level = signal.deviating
            if level == "flag":
                validated.append(tag)
                strongest = max(strongest, 2)
            elif level == "watch":
                validated.append(tag)
                strongest = max(strongest, 1)
        elif tag in states and states[tag].abnormal:
            validated.append(tag)
            strongest = max(strongest, 2)
    if not validated:
        return [], None
    if verdict.verdict == "FLAG" and strongest >= 2:
        severity = "critical"
    elif verdict.verdict == "FLAG" or strongest >= 1:
        severity = "warning"
    else:
        severity = "info"
    return validated, severity

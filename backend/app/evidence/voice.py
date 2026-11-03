"""Marathi voice pipeline: Muse Voice Transcribe -> Wonder structure -> code compares.

Meta's speech model returns text only. Muse Wonder turns the transcript into a
structured observation, but deterministic Python owns the final AGREE/DISAGREE
call by comparing the numeric readings extracted from speech with the readings
accepted from the gauge photo. A mismatch is evidence to revisit, not something
either model can silently overrule.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

DEFAULT_BASE_URL = "https://api.meta.ai/v1"
DEFAULT_MODEL = "muse-voice-transcribe-1.0"


class VoiceError(RuntimeError):
    pass


@dataclass(frozen=True)
class Transcript:
    text: str
    session_id: str = ""
    audio_duration_ms: int = 0
    latency_ms: int = 0
    model: str = DEFAULT_MODEL


class MetaVoiceClient:
    """Buffered WAV transcription through POST /v1/asr/transcribe."""

    def __init__(self, api_key: str, *, base_url: str = DEFAULT_BASE_URL,
                 model: str = DEFAULT_MODEL, timeout_s: float = 120.0,
                 transport: httpx.AsyncBaseTransport | None = None):
        if not api_key:
            raise VoiceError("Meta Model API key is required (MODEL_API_KEY)")
        self._model = model
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},  # httpx sets multipart boundary per request
            timeout=timeout_s,
            transport=transport,
        )

    @property
    def model(self) -> str:
        return self._model

    async def transcribe_wav(
        self, audio_bytes: bytes, *, language_bias: list[str] | None = None,
        keywords: list[str] | None = None,
    ) -> Transcript:
        if not audio_bytes.startswith(b"RIFF") or audio_bytes[8:12] != b"WAVE":
            raise VoiceError("audio must be a RIFF/WAVE file")
        request: dict[str, Any] = {
            "model": self._model,
            "audioEncoding": "WAV",
            "mode": "PUSH_TO_TALK",
            "languageBias": language_bias or ["Marathi", "English"],
            "keywords": keywords or ["PI-201", "PI-202", "inlet", "outlet", "cartridge", "pressure", "psi"],
        }
        started = time.monotonic()
        try:
            response = await self._client.post(
                "/asr/transcribe",
                files={
                    "request": (None, json.dumps(request), "application/json"),
                    "audio": ("voice.wav", audio_bytes, "audio/wav"),
                },
            )
        except httpx.HTTPError as exc:
            raise VoiceError(f"Voice transcription failed: {exc.__class__.__name__}") from exc
        latency_ms = int((time.monotonic() - started) * 1000)
        if response.status_code != 200:
            raise VoiceError(f"Voice transcription returned HTTP {response.status_code}")
        try:
            data = response.json()
            text = str(data["transcript"]).strip()
        except (ValueError, KeyError, TypeError) as exc:
            raise VoiceError("Voice transcription response had no transcript") from exc
        return Transcript(
            text=text,
            session_id=str(data.get("sessionId") or ""),
            audio_duration_ms=int(data.get("audioDurationMs") or 0),
            latency_ms=latency_ms,
            model=self._model,
        )

    async def aclose(self) -> None:
        await self._client.aclose()


class WonderLike(Protocol):
    async def create(self, input_items: list[dict[str, Any]], tools: list[dict[str, Any]], *,
                     reasoning_effort: str = "medium") -> Any: ...


def compare_readings(spoken: dict[str, float], photo: dict[str, float]) -> dict[str, Any]:
    """Deterministic AGREE / DISAGREE / PARTIAL / AWAITING_PHOTO verdict."""
    if not photo:
        return {"status": "AWAITING_PHOTO", "spoken_readings": spoken, "photo_readings": photo,
                "differences": {}, "summary": "Voice received before accepted photo readings."}
    differences = {}
    for tag, photo_value in photo.items():
        if tag in spoken:
            differences[tag] = round(spoken[tag] - photo_value, 2)
    if not differences:
        return {"status": "PARTIAL", "spoken_readings": spoken, "photo_readings": photo,
                "differences": differences, "summary": "Speech did not name any photographed gauge values."}
    disagreements = {
        tag: diff for tag, diff in differences.items()
        if abs(diff) > max(2.0, 0.10 * max(abs(photo[tag]), 1.0))
    }
    if disagreements:
        status = "DISAGREE"
        summary = "Spoken readings differ from photo readings for " + ", ".join(sorted(disagreements)) + "."
    elif len(differences) < len(photo):
        status = "PARTIAL"
        summary = "Spoken readings agree for the gauges named; not every photo reading was spoken."
    else:
        status = "AGREE"
        summary = "Spoken readings agree with photo readings within tolerance."
    return {"status": status, "spoken_readings": spoken, "photo_readings": photo,
            "differences": differences, "summary": summary}


class WonderObservationAnalyzer:
    """Uses Wonder to extract gauge values and a plain observation from speech."""

    def __init__(self, wonder: WonderLike):
        self._wonder = wonder

    async def analyze(self, transcript: str, photo_readings: dict[str, float],
                      expected_tags: list[str]) -> dict[str, Any]:
        reply = await self._wonder.create(
            [{
                "role": "user",
                "content": (
                    "Structure this field operator's spoken observation. Transcript may be Marathi, "
                    "English, or code-switched. Expected gauge tags: " + ", ".join(expected_tags) + ". "
                    "Return only JSON with keys: readings (object mapping expected tag to numeric psi only "
                    "when the operator states that gauge's value), observation (short English summary), "
                    "concerns (array of short strings). Do not invent values.\nTranscript: " + transcript
                ),
            }],
            [],
            reasoning_effort="low",
        )
        structured = self._parse(reply.text, expected_tags)
        comparison = compare_readings(structured["readings"], photo_readings)
        comparison["wonder_summary"] = structured["observation"]
        return {"structured": structured, "comparison": comparison}

    @staticmethod
    def _parse(text: str, expected_tags: list[str]) -> dict[str, Any]:
        readings: dict[str, float] = {}
        observation = ""
        concerns: list[str] = []
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(0))
                raw = data.get("readings") or {}
                for tag in expected_tags:
                    if isinstance(raw.get(tag), (int, float)):
                        readings[tag] = float(raw[tag])
                observation = str(data.get("observation") or "")[:500]
                if isinstance(data.get("concerns"), list):
                    concerns = [str(c)[:200] for c in data["concerns"][:5]]
            except (ValueError, TypeError):
                pass
        if not readings:  # conservative fallback: a number immediately after a tag
            for tag in expected_tags:
                m = re.search(re.escape(tag) + r"[^0-9]{0,24}(\d+(?:\.\d+)?)", text, flags=re.IGNORECASE)
                if m:
                    readings[tag] = float(m.group(1))
        return {"readings": readings, "observation": observation or text.strip()[:500], "concerns": concerns}


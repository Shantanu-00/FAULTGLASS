"""Live smoke test of the Meta Model API roles used by the backend, through the real client classes.

Checks, in order: Muse Wonder (text + tool call), SAM 3.1 on a still, the full gauge pipeline on the
cartridge-bank photo, and Muse Voice Transcribe on the audio track of a field clip. Prints only
results and latencies, never the key.

usage: cd backend && uv run python scripts/smoke_meta.py [--no-voice]
key:   MODEL_API_KEY (or META_MODEL_API) in the environment or the repo-root .env
"""
from __future__ import annotations

import asyncio
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.evidence.gauge import GaugePipeline, WonderGaugeReader, image_data_url  # noqa: E402
from app.evidence.sam import SamClient  # noqa: E402
from app.evidence.voice import MetaVoiceClient  # noqa: E402
from app.investigator.__main__ import meta_key  # noqa: E402
from app.investigator.wonder import WonderClient  # noqa: E402
from app.plant import load_pack  # noqa: E402
from app.watcher.__main__ import load_repo_env  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
PACK = REPO / "plants" / "waterplant"
BANK_PHOTO = PACK / "assets" / "Screenshot From 2026-11-02 11-50-26.png"
SPEECH_CLIP = PACK / "assets" / "WhatsApp Video 2026-11-01 at 19.53.28.mp4"

TOOL = {
    "type": "function",
    "name": "get_reading",
    "description": "Return the latest value of an instrument tag.",
    "parameters": {"type": "object", "properties": {"tag": {"type": "string"}}, "required": ["tag"]},
}


async def step(name: str, coro):
    try:
        await coro
    except Exception as exc:
        print(f"{name}: FAILED {exc.__class__.__name__}: {str(exc)[:200]}")


async def wonder(key: str) -> None:
    client = WonderClient(key)
    try:
        reply = await client.create(
            [{"role": "user", "content": "Call get_reading for tag FIT-301, then wait for the result."}],
            [TOOL], reasoning_effort="low")
        calls = [(c.get("name"), c.get("arguments")) for c in reply.function_calls]
        kinds = sorted({i.get("type") for i in reply.output})
        print(f"wonder: model={reply.model} latency_ms={reply.latency_ms} output_types={kinds} tool_calls={calls}")
        encrypted = any(i.get("type") == "reasoning" and i.get("encrypted_content") for i in reply.output)
        print(f"wonder: encrypted reasoning returned={encrypted}")
    finally:
        await client.aclose()


async def sam_and_gauges(key: str) -> None:
    pack = load_pack(PACK)
    sam, w = SamClient(key), WonderClient(key)
    try:
        data = BANK_PHOTO.read_bytes()
        reply = await sam.segment_image(image_data_url(data), "pressure gauge")
        print(f"sam: model={reply.model} latency_ms={reply.latency_ms} gauges_found={len(reply.detections)}")
        expected = [i for i in pack.instruments if i.observe == "field_photo" and (i.location_note or "").find("row, line") >= 0]
        readings = await GaugePipeline(sam, WonderGaugeReader(w)).process(data, expected)
        for r in readings:
            print(f"gauge {r.tag}: status={r.status} wonder_psi={r.wonder_psi} needle_psi={r.needle_psi} value={r.value}")
    finally:
        await sam.aclose()
        await w.aclose()


async def voice(key: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "clip.wav"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(SPEECH_CLIP), "-vn", "-ac", "1",
                        "-ar", "16000", "-sample_fmt", "s16", str(wav)], check=True)
        client = MetaVoiceClient(key)
        try:
            t = await client.transcribe_wav(wav.read_bytes())
            print(f"voice: model={t.model} latency_ms={t.latency_ms} audio_ms={t.audio_duration_ms} transcript={t.text!r}")
        finally:
            await client.aclose()


async def main() -> int:
    load_repo_env()
    key = meta_key()
    await step("wonder", wonder(key))
    await step("sam/gauges", sam_and_gauges(key))
    if "--no-voice" not in sys.argv:
        await step("voice", voice(key))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

"""SAM 3.1 segmentation client (Meta Model API, Responses, streaming).

SAM only locates: it returns a box + pixel mask per instance for one short
concept prompt per request ("pressure gauge", "gauge needle", "valve lever",
"pipe"). It never reads values and never computes angles; that is done with
Wonder vision and deterministic code respectively (docs/DEMO.md).

Wire format is the documented special-token grammar (docs/meta/sam/
reading-segmentation.md): one line per frame, `id<|box;...|><|mask;...|>`.
Boxes/confidence are parsed here; mask rasters are decoded with Meta's
official `meta_sam_parser` when a raster is needed (needle/lever geometry).
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://api.meta.ai/v1"
DEFAULT_MODEL = "sam-3.1"

_FRAME_RE = re.compile(r"<(\d+)f>")
_RECORD_RE = re.compile(
    r"(?P<id>\d+)<\|box;x1=(?P<x1>\d+);y1=(?P<y1>\d+);x2=(?P<x2>\d+);y2=(?P<y2>\d+)"
    r";w=(?P<w>\d+);h=(?P<h>\d+)(?:;c=(?P<bc>[\d.]+))?\|>"
    r"<\|mask;x=0;y=0(?:;c=(?P<mc>[\d.]+))?;data=(?P<mh>\d+),(?P<mw>\d+),(?P<enc>[~!])(?P<payload>[^|]*)\|>"
)


@dataclass(frozen=True)
class Detection:
    object_id: int
    frame: int
    box: tuple[int, int, int, int]  # x1, y1, x2, y2 in source pixels
    frame_size: tuple[int, int]     # (w, h)
    confidence: float | None = None
    mask_h: int = 0
    mask_w: int = 0
    mask_encoding: str = "~"
    mask_payload: str = ""

    @property
    def center(self) -> tuple[float, float]:
        return ((self.box[0] + self.box[2]) / 2, (self.box[1] + self.box[3]) / 2)

    @property
    def area(self) -> int:
        return max(0, self.box[2] - self.box[0]) * max(0, self.box[3] - self.box[1])


def parse_sam_text(text: str) -> list[Detection]:
    """Parse the documented SAM output grammar (all frames)."""
    detections: list[Detection] = []
    for line in text.splitlines():
        frame_match = _FRAME_RE.search(line)
        if not frame_match:
            continue
        frame = int(frame_match.group(1))
        for m in _RECORD_RE.finditer(line):
            conf = m.group("bc") or m.group("mc")
            detections.append(Detection(
                object_id=int(m.group("id")), frame=frame,
                box=(int(m.group("x1")), int(m.group("y1")), int(m.group("x2")), int(m.group("y2"))),
                frame_size=(int(m.group("w")), int(m.group("h"))),
                confidence=float(conf) if conf else None,
                mask_h=int(m.group("mh")), mask_w=int(m.group("mw")),
                mask_encoding=m.group("enc"), mask_payload=m.group("payload"),
            ))
    return detections


def decode_raster(det: Detection) -> bytes | None:
    """Decode a mask payload to a row-major 0/1 raster via Meta's parser.

    Returns None when decoding is unavailable; callers must treat geometry
    derived from it as absent, not as zero.
    """
    if not det.mask_payload or not det.mask_h or not det.mask_w:
        return None
    try:
        import base64 as _b64  # payload is base85, parser handles it; this is a guard only
        from meta_sam_parser import SegmentationMask, decode_mask_to_raster
        mask = SegmentationMask(
            height=det.mask_h, width=det.mask_w,
            encoding="one_bit" if det.mask_encoding == "!" else "lossless",
            payload=det.mask_payload,
        )
        raster = decode_mask_to_raster(mask)
        return bytes(raster)
    except Exception:
        return None


class SamError(RuntimeError):
    pass


@dataclass(frozen=True)
class SamReply:
    detections: list[Detection] = field(default_factory=list)
    latency_ms: int = 0
    model: str = DEFAULT_MODEL
    raw_frames: int = 0


class SamClient:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        model: str = DEFAULT_MODEL,
        timeout_s: float = 300.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        if not api_key:
            raise SamError("Meta Model API key is required (MODEL_API_KEY)")
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

    async def segment_image(self, image_data_url: str, concept: str) -> SamReply:
        """Segment one concept in one still image. Zero matches is valid."""
        return await self._segment(
            [{"type": "input_text", "text": concept},
             {"type": "input_image", "image_url": image_data_url}],
        )

    async def segment_video(self, video_url: str, concept: str, *,
                            prompt_text: str | None = None) -> SamReply:
        """Segment/track one concept in a clip (one line per frame returned)."""
        return await self._segment(
            [{"type": "input_text", "text": prompt_text or concept},
             {"type": "input_video", "video_url": video_url}],
        )

    async def _segment(self, content: list[dict[str, Any]]) -> SamReply:
        started = time.monotonic()
        text_parts: list[str] = []
        frames = 0
        try:
            async with self._client.stream(
                "POST", "/responses",
                json={
                    "model": self._model,
                    "input": [{"type": "message", "role": "user", "content": content}],
                    "stream": True,
                    "metadata": {"include_confidence": "true", "mask_encoding": "one_bit"},
                },
            ) as response:
                if response.status_code != 200:
                    raise SamError(f"SAM returned HTTP {response.status_code}")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    try:
                        event = json.loads(line[5:])
                    except ValueError:
                        continue
                    if event.get("type") == "response.output_text.delta":
                        delta = event.get("delta", "")
                        text_parts.append(delta)
                        if _FRAME_RE.search(delta):
                            frames += 1
        except httpx.HTTPError as exc:
            raise SamError(f"SAM request failed: {exc.__class__.__name__}") from exc
        latency_ms = int((time.monotonic() - started) * 1000)
        return SamReply(detections=parse_sam_text("".join(text_parts)),
                        latency_ms=latency_ms, model=self._model, raw_frames=frames)

    async def aclose(self) -> None:
        await self._client.aclose()

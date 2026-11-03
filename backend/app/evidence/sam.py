"""SAM 3.1 segmentation client (Meta Model API, Responses, streaming).

SAM only locates and masks: it returns a box + pixel mask per instance for one
short concept prompt per request ("pressure gauge", "yellow valve handle", "hand",
"pipe"). It
never reads values. Muse Wonder reads gauges from the masked dial crop; code
does the lever motion geometry.

Wire format is the documented special-token grammar (docs/meta/sam/
reading-segmentation.md): one line per frame, `id<|box;...|><|mask;...|>`.
Boxes/confidence are parsed here; mask rasters are decoded with Meta's
official `meta_sam_parser` when a raster is needed (dial cut-out, lever geometry).
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
    raster: bytes | None = field(default=None, repr=False, compare=False)
    mask_bounds: tuple[int, int, int, int] | None = None

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
    """Return the row-major 0/1 mask raster decoded by Meta's official parser."""
    if det.raster is not None:
        return det.raster
    if not det.mask_payload or not det.mask_h or not det.mask_w:
        return None
    try:
        from meta_sam_parser import SegmentationMask, decode_mask_to_raster
        mask = SegmentationMask(
            encoding="one_bit" if det.mask_encoding == "!" else "lossless",
            payload=det.mask_payload, width=det.mask_w, height=det.mask_h)
        return bytes(decode_mask_to_raster(mask))
    except Exception:
        return None


def detections_from_records(records) -> list[Detection]:
    """Combine official box + mask records into Detections with rasters."""
    from meta_sam_parser import SegmentationBoxRecord, SegmentationMaskRecord, decode_mask_to_raster

    boxes: dict[tuple[int, int], SegmentationBoxRecord] = {}
    masks: dict[tuple[int, int], SegmentationMaskRecord] = {}
    media_w = media_h = 0
    for record in records:
        frame = record.frame.frame_index if getattr(record, "frame", None) else 0
        if isinstance(record, SegmentationBoxRecord):
            boxes[(record.object_id, frame)] = record
            media_w = max(media_w, record.right)
            media_h = max(media_h, record.bottom)
        elif isinstance(record, SegmentationMaskRecord):
            masks[(record.object_id, frame)] = record
    detections: list[Detection] = []
    for key in sorted(set(boxes) | set(masks), key=lambda k: (k[1], k[0])):
        box_rec = boxes.get(key)
        mask_rec = masks.get(key)
        if box_rec is not None:
            box = (box_rec.left, box_rec.top, box_rec.right, box_rec.bottom)
            confidence = box_rec.confidence
        elif mask_rec is not None:
            b = mask_rec.bounds
            box = (b.left, b.top, b.right, b.bottom)
            confidence = mask_rec.confidence
        else:
            continue
        raster = None
        mask_w = mask_h = 0
        bounds = None
        if mask_rec is not None:
            try:
                raster = bytes(decode_mask_to_raster(mask_rec.mask))
            except Exception:
                raster = None
            mask_w, mask_h = mask_rec.mask.width, mask_rec.mask.height
            b = mask_rec.bounds
            bounds = (b.left, b.top, b.right, b.bottom)
            confidence = confidence if confidence is not None else mask_rec.confidence
        detections.append(Detection(
            object_id=key[0], frame=key[1], box=box,
            frame_size=(media_w, media_h), confidence=confidence,
            mask_h=mask_h, mask_w=mask_w, raster=raster, mask_bounds=bounds))
    return detections


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
            headers={"Authorization": f"Bearer {api_key}"},
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
            media="image",
        )

    async def segment_video(self, video_url: str, concept: str, *,
                            prompt_text: str | None = None) -> SamReply:
        """Segment/track one concept in a clip (one line per frame returned)."""
        return await self._segment(
            [{"type": "input_text", "text": prompt_text or concept},
             {"type": "input_video", "video_url": video_url}],
            media="video",
        )

    async def upload_file(self, data: bytes, filename: str, content_type: str) -> str:
        """Upload media once through the Files API (purpose=user_data)."""
        try:
            response = await self._client.post(
                "/files",
                data={"purpose": "user_data"},
                files={"file": (filename, data, content_type)},
            )
        except httpx.HTTPError as exc:
            raise SamError(f"SAM file upload failed: {exc.__class__.__name__}") from exc
        if response.status_code != 200:
            raise SamError(f"SAM file upload returned HTTP {response.status_code}")
        try:
            return str(response.json()["id"])
        except (ValueError, KeyError, TypeError) as exc:
            raise SamError("SAM file upload response had no id") from exc

    async def segment_video_file(self, file_id: str, concept: str) -> SamReply:
        """Segment/track one concept in an uploaded clip."""
        return await self._segment(
            [{"type": "input_text", "text": concept},
             {"type": "input_video", "file_id": file_id}],
            media="video",
        )

    async def _segment(self, content: list[dict[str, Any]], *, media: str) -> SamReply:
        started = time.monotonic()
        events: list[dict[str, Any]] = []
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
                    events.append(event)
                    if event.get("type") == "response.output_text.delta":
                        delta = event.get("delta", "")
                        text_parts.append(delta)
                        if _FRAME_RE.search(delta):
                            frames += 1
        except httpx.HTTPError as exc:
            raise SamError(f"SAM request failed: {exc.__class__.__name__}") from exc
        latency_ms = int((time.monotonic() - started) * 1000)
        detections = await self._official_detections(events, media)
        if detections is None:
            detections = parse_sam_text("".join(text_parts))
        return SamReply(detections=detections, latency_ms=latency_ms,
                        model=self._model, raw_frames=frames)

    @staticmethod
    async def _official_detections(events: list[dict[str, Any]], media: str) -> list[Detection] | None:
        """Parse through meta_sam_parser; None means fall back to wire regex."""
        if not events:
            return []
        try:
            from meta_sam_parser import (
                image_segmentation_format, parse_responses_stream, video_segmentation_format)

            async def source():
                for event in events:
                    yield event

            fmt = video_segmentation_format() if media == "video" else image_segmentation_format()
            result = await parse_responses_stream(source(), fmt).final_result()
            return detections_from_records(result.records)
        except Exception:
            return None

    async def aclose(self) -> None:
        await self._client.aclose()

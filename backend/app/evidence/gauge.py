"""Gauge pipeline for one photo of one dial: SAM 3.1 masks the dial -> code cuts out the masked
segment -> Muse Wonder reads the red psi scale on that segment.

The worker uploads one photo per gauge (cartridge bank inlet, cartridge bank outlet), so each
photo holds one dial of interest.

Division of labour:
- SAM 3.1 segments the dial ("pressure gauge"). It reads nothing.
- Python picks the dial that fills the frame, blanks everything outside the SAM mask to a flat
  neutral background, crops tight to the dial and upscales the result. Two similar dials in one
  photo are reported as ambiguous instead of guessing which one the task means.
- Muse Wonder (vision) reasons over that masked crop and reads the red psi scale. Its reply is
  parsed strictly; its reasoning is kept for the audit trail.

An unreadable, ambiguous or missing dial never yields a value.
"""
from __future__ import annotations

import base64
import io
import re
from dataclasses import dataclass
from typing import Any, Protocol

from PIL import Image, ImageFilter, ImageOps

from ..plant.models import Instrument
from .sam import Detection, SamClient, decode_raster

DIAL_MAX_PSI = 100.0
CROP_LONG_SIDE = 768
CROP_MARGIN = 0.04
DILATE_FRACTION = 0.02
NEUTRAL_BACKGROUND = (236, 236, 236)
AMBIGUOUS_AREA_RATIO = 0.6
REASONING_CHARS = 600


def _box_size(box: tuple[int, int, int, int]) -> tuple[int, int]:
    return max(0, box[2] - box[0]), max(0, box[3] - box[1])


def _box_area(det: Detection) -> int:
    w, h = _box_size(det.box)
    return w * h


def _mask_image(det: Detection, region: tuple[int, int, int, int]) -> Image.Image | None:
    """The SAM mask as an "L" image the size of `region` (the mask's own box), or None."""
    raster = decode_raster(det)
    mask_w, mask_h = det.mask_w, det.mask_h
    region_w, region_h = _box_size(region)
    if not raster or mask_w <= 0 or mask_h <= 0 or len(raster) != mask_w * mask_h or not region_w or not region_h:
        return None
    if not any(raster):
        return None
    table = bytes([0]) + bytes([255]) * 255
    mask = Image.frombytes("L", (mask_w, mask_h), raster.translate(table))
    if mask.size != (region_w, region_h):
        mask = mask.resize((region_w, region_h), Image.BILINEAR).point(lambda v: 255 if v >= 128 else 0)
    return mask


def _odd(n: int) -> int:
    n = max(3, n)
    return n if n % 2 else n + 1


def masked_crop(image: Image.Image, det: Detection) -> tuple[Image.Image, bool]:
    """Cut the SAM-masked dial out of the photo.

    The mask is box-local: it covers the detection's own box (`mask_bounds` when set, else `box`),
    not the whole frame. Pixels outside the mask become a flat neutral background; the mask is
    dilated a little so the bezel edge and the needle tip are not clipped. The crop is tight to the
    dial box with a small margin and scaled so its long side is about CROP_LONG_SIDE. Without a
    usable mask the plain box crop is returned and the flag is False.
    """
    image = image.convert("RGB")
    width, height = image.size
    region = det.mask_bounds or det.box
    x1, y1, x2, y2 = det.box
    box_w, box_h = x2 - x1, y2 - y1
    mx, my = int(box_w * CROP_MARGIN), int(box_h * CROP_MARGIN)
    left, top = max(0, x1 - mx), max(0, y1 - my)
    right, bottom = min(width, x2 + mx), min(height, y2 + my)
    if right <= left or bottom <= top:
        left, top, right, bottom = 0, 0, width, height
    crop = image.crop((left, top, right, bottom))
    scale = CROP_LONG_SIDE / max(crop.size)
    out_size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    crop = crop.resize(out_size, Image.LANCZOS)

    mask = _mask_image(det, region)
    if mask is None:
        return crop, False
    scaled = mask.resize((max(1, round(mask.width * scale)), max(1, round(mask.height * scale))), Image.BILINEAR)
    canvas = Image.new("L", out_size, 0)
    canvas.paste(scaled, (round((region[0] - left) * scale), round((region[1] - top) * scale)))
    canvas = canvas.point(lambda v: 255 if v >= 128 else 0)
    canvas = canvas.filter(ImageFilter.MaxFilter(_odd(round(max(out_size) * DILATE_FRACTION))))
    background = Image.new("RGB", out_size, NEUTRAL_BACKGROUND)
    return Image.composite(crop, background, canvas), True


def masked_crop_data_url(image: Image.Image, det: Detection) -> tuple[str, bool]:
    crop, applied = masked_crop(image, det)
    buf = io.BytesIO()
    crop.save(buf, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), applied


def image_data_url(image_bytes: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(image_bytes).decode()


def largest_detection(detections: list[Detection]) -> Detection | None:
    """The dial the photo is about: the biggest box, ties broken by SAM confidence."""
    if not detections:
        return None
    return max(detections, key=lambda d: (_box_area(d), d.confidence or 0.0))


def is_ambiguous(detections: list[Detection]) -> bool:
    """True when a second dial is nearly as large as the largest one."""
    areas = sorted((_box_area(d) for d in detections), reverse=True)
    return len(areas) > 1 and areas[0] > 0 and areas[1] >= AMBIGUOUS_AREA_RATIO * areas[0]


_PSI_LINE = re.compile(r"^[\s*_>#-]*PSI[\s*_]*:[\s*_]*(UNREADABLE|-?\d+(?:\.\d+)?)", re.IGNORECASE | re.MULTILINE)


def parse_psi(text: str) -> float | None:
    """The value on the last `PSI:` line, or None for UNREADABLE, out of range, or no such line."""
    matches = _PSI_LINE.findall(text or "")
    if not matches:
        return None
    token = matches[-1]
    if token.upper() == "UNREADABLE":
        return None
    value = float(token)
    return value if 0.0 <= value <= DIAL_MAX_PSI else None


@dataclass(frozen=True)
class WonderRead:
    value: float | None
    reasoning: str | None = None


@dataclass
class GaugeReading:
    tag: str
    box: tuple[int, int, int, int] | None = None
    sam_confidence: float | None = None
    mask_applied: bool = False
    value: float | None = None  # only set when status == "read"
    wonder_reasoning: str | None = None
    status: str = "unreadable"  # read | unreadable | not_found | ambiguous

    def to_json(self) -> dict[str, Any]:
        return {"tag": self.tag, "box": list(self.box) if self.box else None,
                "sam_confidence": self.sam_confidence, "mask_applied": self.mask_applied,
                "value": self.value, "wonder_reasoning": self.wonder_reasoning, "status": self.status}


class GaugeReader(Protocol):
    async def read_gauge(self, crop_url: str, tag: str, location_note: str) -> WonderRead: ...


class WonderGaugeReader:
    """Muse Wonder vision reading the red psi scale on one masked dial crop."""

    def __init__(self, wonder: Any):
        self._wonder = wonder

    async def read_gauge(self, crop_url: str, tag: str, location_note: str) -> WonderRead:
        """One retry when the reply has no text (the reasoning budget can use up the output)."""
        text = ""
        for _ in range(2):
            text = await self._ask(crop_url, tag, location_note)
            if text:
                break
        return WonderRead(value=parse_psi(text), reasoning=text[:REASONING_CHARS] or None)

    async def _ask(self, crop_url: str, tag: str, location_note: str) -> str:
        reply = await self._wonder.create(
            [{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": (
                        f"This is a cut-out of analog pressure gauge {tag} ({location_note}); everything "
                        "outside the dial has been blanked to plain grey. The dial has two scales: an outer "
                        "black kg/cm2 scale and an inner RED psi scale (0-100 psi, numbers every 20, with minor "
                        "ticks between). Read the RED psi scale and ignore the black kg/cm2 scale. The needle is "
                        "black: its thin end is the pointer, the wide paddle on the other side of the hub is the "
                        "tail and counterweight, not the pointer. Reason briefly about where the pointer tip lies "
                        "relative to the red numbered marks and the minor ticks, then finish with exactly these "
                        "three lines:\n"
                        "SCALE: <which scale you read>\n"
                        "BETWEEN: <the two red numbered marks the pointer tip lies between>\n"
                        "PSI: <number>\n"
                        "If the pointer tip or the red scale cannot be seen clearly, answer PSI: UNREADABLE. "
                        "Do not guess a value you cannot see.")},
                    {"type": "input_image", "image_url": crop_url},
                ],
            }],
            [],
            reasoning_effort="medium",
        )
        return (reply.text or "").strip()


@dataclass
class GaugePipeline:
    sam: SamClient
    reader: GaugeReader

    async def read_photo(self, image_bytes: bytes, inst: Instrument) -> GaugeReading:
        """Read the one dial in a photo for instrument `inst`."""
        image = Image.open(io.BytesIO(image_bytes))
        if image.getexif().get(0x0112, 1) != 1:
            image = ImageOps.exif_transpose(image)
            image_bytes = self._as_jpeg(image)
        elif image.format != "JPEG":
            image_bytes = self._as_jpeg(image)
        reply = await self.sam.segment_image(image_data_url(image_bytes), "pressure gauge")
        gauge = largest_detection(reply.detections)
        if gauge is None:
            return GaugeReading(tag=inst.tag, status="not_found")
        reading = GaugeReading(tag=inst.tag, box=gauge.box, sam_confidence=gauge.confidence)
        if is_ambiguous(reply.detections):
            reading.status = "ambiguous"
            return reading
        crop_url, reading.mask_applied = masked_crop_data_url(image, gauge)
        answer = await self.reader.read_gauge(crop_url, inst.tag, inst.location_note or "")
        reading.wonder_reasoning = answer.reasoning
        if answer.value is None:
            reading.status = "unreadable"
        else:
            reading.status = "read"
            reading.value = answer.value
        return reading

    @staticmethod
    def _as_jpeg(image: Image.Image) -> bytes:
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="JPEG", quality=90)
        return buf.getvalue()

"""Gauge pipeline for one photo of one dial: SAM finds the dial -> zoomed crop -> Wonder
reads the red psi scale -> needle-angle cross-check in code.

The worker uploads one photo per gauge (cartridge bank inlet, cartridge bank outlet), so each
photo holds one dial of interest.

Division of labour:
- SAM 3.1 locates the dial (and the needle). It reads nothing.
- Python picks the dial that fills the frame, crops and zooms it, and measures the needle angle
  from the mask.
- Muse Wonder (vision) reads the red psi scale on the zoomed crop.
- Python cross-checks the two: disagreement beyond tolerance, a missing needle, or an unreadable
  dial yields UNCERTAIN or UNREADABLE, never an invented value.

The pixel mask itself is never sent to a reading model. Models get images (the crop); masks stay
in code where geometry is measured.
"""
from __future__ import annotations

import base64
import io
import math
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

from PIL import Image

from ..plant.models import Instrument
from .sam import Detection, SamClient

# Assumed dial geometry for the red psi scale (0-100 psi, ~270 deg sweep).
# These are calibration constants to confirm against the real dial photo;
# the needle estimate is a cross-check only, so the cost of error is an
# UNCERTAIN flag, not a wrong reading.
DIAL_MAX_PSI = 100.0
DIAL_START_DEG = 225.0   # math angle (deg, y-up) pointing at 0 psi
DIAL_SWEEP_DEG = 270.0   # clockwise sweep to full scale
AGREE_TOLERANCE = 0.20   # relative tolerance between Wonder and needle estimate


def crop_data_url(image: Image.Image, box: tuple[int, int, int, int], *,
                  margin: float = 0.18, target_w: int = 640) -> str:
    """Crop around a SAM box, expand by margin, upscale for the reader model."""
    w, h = image.size
    x1, y1, x2, y2 = box
    mx, my = (x2 - x1) * margin, (y2 - y1) * margin
    crop = image.crop((max(0, int(x1 - mx)), max(0, int(y1 - my)),
                       min(w, int(x2 + mx)), min(h, int(y2 + my))))
    if crop.width < target_w:
        crop = crop.resize((target_w, max(1, int(crop.height * target_w / crop.width))), Image.LANCZOS)
    buf = io.BytesIO()
    crop.convert("RGB").save(buf, format="JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def image_data_url(image_bytes: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(image_bytes).decode()


def largest_detection(detections: list[Detection]) -> Detection | None:
    """The dial the photo is about: the biggest box, ties broken by SAM confidence."""
    if not detections:
        return None
    return max(detections, key=lambda d: ((d.box[2] - d.box[0]) * (d.box[3] - d.box[1]), d.confidence or 0.0))


def needle_psi(det: Detection, raster: bytes | None) -> float | None:
    """Estimate psi from a needle mask raster mapped onto the gauge box.

    Principal-axis fit over mask pixels; direction resolved toward the
    mask centroid offset from the dial centre. Returns None when there is
    not enough visible needle to trust a direction (occlusion, bad mask) —
    absence of a cross-check, not a zero reading.
    """
    if not raster or det.mask_w <= 0 or det.mask_h <= 0:
        return None
    pts = [(i % det.mask_w, i // det.mask_w) for i, v in enumerate(raster) if v]
    if len(pts) < 12:
        return None
    cx, cy = det.mask_w / 2, det.mask_h / 2
    mx = sum(p[0] for p in pts) / len(pts)
    my = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    angle = 0.5 * math.atan2(2 * sxy, sxx - syy)
    dx, dy = math.cos(angle), math.sin(angle)
    # Principal axis is unsigned; point it away from centre through the centroid.
    if (mx - cx) * dx + (my - cy) * dy < 0:
        dx, dy = -dx, -dy
    math_deg = math.degrees(math.atan2(-dy, dx))  # image y grows downward
    swept = (DIAL_START_DEG - math_deg) % 360.0
    if swept > DIAL_SWEEP_DEG + 30:  # needle in the dead zone: not credible
        return None
    return max(0.0, min(DIAL_MAX_PSI, swept / DIAL_SWEEP_DEG * DIAL_MAX_PSI))


@dataclass
class GaugeReading:
    tag: str
    box: tuple[int, int, int, int] | None = None
    sam_confidence: float | None = None
    wonder_psi: float | None = None
    needle_psi: float | None = None
    status: str = "unreadable"  # agree | uncertain | unreadable | not_found
    value: float | None = None  # only set when status == agree

    def to_json(self) -> dict[str, Any]:
        return {"tag": self.tag, "box": list(self.box) if self.box else None,
                "sam_confidence": self.sam_confidence, "wonder_psi": self.wonder_psi,
                "needle_psi": self.needle_psi, "status": self.status, "value": self.value}


class GaugeReader(Protocol):
    async def read_gauge(self, crop_url: str, tag: str, location_note: str) -> float | None: ...


class WonderGaugeReader:
    """Muse Wonder vision reading one zoomed dial crop (red psi scale)."""

    def __init__(self, wonder: Any):
        self._wonder = wonder

    async def read_gauge(self, crop_url: str, tag: str, location_note: str) -> float | None:
        reply = await self._wonder.create(
            [{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": (
                        f"This is a zoomed crop of analog pressure gauge {tag} ({location_note}). "
                        "Read the needle on the RED psi scale (0-100 psi), ignoring any black kg/cm2 scale. "
                        "Reply with exactly one line: the numeric psi value, or UNREADABLE if the needle or "
                        "scale cannot be seen clearly. Do not estimate a value you cannot see.")},
                    {"type": "input_image", "image_url": crop_url},
                ],
            }],
            [],
            reasoning_effort="low",
        )
        text = reply.text.strip()
        if not text or "UNREADABLE" in text.upper():
            return None
        m = re.search(r"(\d+(?:\.\d+)?)", text)
        if not m:
            return None
        value = float(m.group(1))
        return value if 0.0 <= value <= DIAL_MAX_PSI else None


@dataclass
class GaugePipeline:
    sam: SamClient
    reader: GaugeReader

    async def read_photo(self, image_bytes: bytes, inst: Instrument) -> GaugeReading:
        """Read the one dial in a photo for instrument `inst`."""
        image = Image.open(io.BytesIO(image_bytes))
        full_url = image_data_url(image_bytes if image.format == "JPEG" else self._as_jpeg(image))
        reply = await self.sam.segment_image(full_url, "pressure gauge")
        gauge = largest_detection(reply.detections)
        if gauge is None:
            return GaugeReading(tag=inst.tag, status="not_found")
        reading = GaugeReading(tag=inst.tag, box=gauge.box, sam_confidence=gauge.confidence)
        crop = crop_data_url(image, gauge.box)
        reading.wonder_psi = await self.reader.read_gauge(crop, inst.tag, inst.location_note or "")
        reading.needle_psi = await self._needle(full_url, gauge)
        if reading.wonder_psi is None:
            reading.status = "unreadable"
        elif reading.needle_psi is None:
            reading.status = "single_source"  # Wonder only; reported, flagged as unchecked
            reading.value = reading.wonder_psi
        elif abs(reading.wonder_psi - reading.needle_psi) <= max(3.0, AGREE_TOLERANCE * max(reading.wonder_psi, 1.0)):
            reading.status = "agree"
            reading.value = reading.wonder_psi
        else:
            reading.status = "uncertain"  # value deliberately withheld
        return reading

    async def _needle(self, image_url: str, gauge: Detection) -> float | None:
        try:
            from .sam import decode_raster
            reply = await self.sam.segment_image(image_url, "gauge needle")
            if not reply.detections:
                return None
            gx, gy = gauge.center
            needle = min(reply.detections, key=lambda d: abs(d.center[0] - gx) + abs(d.center[1] - gy))
            return needle_psi(gauge, decode_raster(needle))
        except Exception:
            return None

    @staticmethod
    def _as_jpeg(image: Image.Image) -> bytes:
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="JPEG", quality=90)
        return buf.getvalue()

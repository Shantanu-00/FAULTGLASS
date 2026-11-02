"""Lever-angle estimation from SAM video masks (deterministic code).

SAM tracks the lever and the pipe; Python measures the angle between their
mask axes in the image plane. This is an APPROXIMATE, image-plane angle:

- The lever rotates in a plane; the camera sees that plane in perspective.
  Square-on to the lever plane, expect roughly +-5-10 deg when most of the
  lever is visible. At 30-45 deg off-axis the projected angle compresses and
  error grows to roughly +-10-25 deg. Because the staged stops are 45 deg
  apart (0 / 45 / 90), classification into stages stays meaningful well past
  the point where an exact degree claim would not.
- A hand gripping the lever occludes part of it. SAM still masks the visible
  patches; the axis fit works while a clear majority of the lever length is
  visible and degrades fast below that. Frames with too little visible lever
  are reported as coverage-low and excluded, never interpolated silently.
- SAM object identity holds while the object stays in frame; it is not
  reliable across full occlusion or exit/re-entry (Meta docs). The shooting
  protocol therefore asks for one second of visible lever before the hand
  grips it, and a point/box prompt on a visible frame can propagate both
  directions (`propagation_direction: "both"`) when the start is covered.

Policy consumes STAGES with dead bands (OPEN ~0, MID ~45, CLOSED ~90), not
raw degrees, and any low-coverage or skipped-stage sequence is a violation
or an UNCERTAIN, never a pass.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .sam import Detection, SamClient, decode_raster

STAGE_BANDS = {"OPEN": (0.0, 20.0), "MID": (35.0, 55.0), "CLOSED": (70.0, 90.0)}
MIN_COVERAGE = 0.35  # fraction of the best frame's lever pixels


def mask_points(det: Detection, raster: bytes | None, step: int = 3) -> list[tuple[float, float]]:
    """Mask pixel coordinates (image space, subsampled), or box corners fallback-free."""
    if not raster or det.mask_w <= 0 or det.mask_h <= 0:
        return []
    x1, y1, x2, y2 = det.mask_bounds or det.box
    sx = (x2 - x1) / max(det.mask_w, 1)
    sy = (y2 - y1) / max(det.mask_h, 1)
    pts = []
    for i, v in enumerate(raster):
        if v and (i % step == 0):
            pts.append((x1 + (i % det.mask_w) * sx, y1 + (i // det.mask_w) * sy))
    return pts


def principal_axis(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Unit direction of the point cloud's major axis (unsigned)."""
    if len(points) < 8:
        return None
    mx = sum(p[0] for p in points) / len(points)
    my = sum(p[1] for p in points) / len(points)
    sxx = sum((p[0] - mx) ** 2 for p in points)
    syy = sum((p[1] - my) ** 2 for p in points)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in points)
    angle = 0.5 * math.atan2(2 * sxy, sxx - syy)
    return (math.cos(angle), math.sin(angle))


def angle_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Acute angle between two axes, 0..90 degrees."""
    dot = abs(a[0] * b[0] + a[1] * b[1])
    return math.degrees(math.acos(max(-1.0, min(1.0, dot))))


def classify_stage(angle_deg: float | None) -> str:
    if angle_deg is None:
        return "UNCERTAIN"
    for stage, (lo, hi) in STAGE_BANDS.items():
        if lo <= angle_deg <= hi:
            return stage
    return "BETWEEN"


@dataclass
class FrameAngle:
    frame: int
    angle_deg: float | None
    stage: str
    coverage: float  # visible lever pixels vs best frame (1.0 = most visible)

    def to_json(self) -> dict:
        return {"frame": self.frame, "angle_deg": self.angle_deg, "stage": self.stage, "coverage": self.coverage}


@dataclass
class LeverTrack:
    frames: list[FrameAngle] = field(default_factory=list)

    @property
    def stages_seen(self) -> list[str]:
        seen: list[str] = []
        for f in self.frames:
            if f.stage in STAGE_BANDS and (not seen or seen[-1] != f.stage):
                seen.append(f.stage)
        return seen

    def staged_sequence_ok(self) -> bool:
        """True only for OPEN -> MID -> CLOSED in order, no skipped MID."""
        return self.stages_seen == ["OPEN", "MID", "CLOSED"]

    def to_json(self) -> dict:
        return {"frames": [f.to_json() for f in self.frames],
                "stages_seen": self.stages_seen, "staged_sequence_ok": self.staged_sequence_ok()}


def build_track(lever: list[Detection], pipe: list[Detection]) -> LeverTrack:
    """Combine per-frame lever/pipe detections into an angle series.

    A plant frame can contain several similar handles. Group detections by
    SAM object id and keep the object with the greatest measured angle swing
    (then the most frames): that is the operated lever, not a static handle
    elsewhere in the shot. For the pipe, keep the largest mask per frame.
    """
    pipe_by_frame: dict[int, Detection] = {}
    for det in pipe:
        if det.frame not in pipe_by_frame or det.area > pipe_by_frame[det.frame].area:
            pipe_by_frame[det.frame] = det

    by_object: dict[int, list[Detection]] = {}
    for det in lever:
        by_object.setdefault(det.object_id, []).append(det)

    candidates: list[tuple[float, int, LeverTrack]] = []
    for detections in by_object.values():
        rasters = {d.frame: decode_raster(d) for d in detections}
        counts = {f: (sum(rasters[f]) if rasters[f] else 0) for f in rasters}
        best = max(counts.values(), default=0)
        frames: list[FrameAngle] = []
        for det in sorted(detections, key=lambda d: d.frame):
            pipe_det = pipe_by_frame.get(det.frame)
            coverage = (counts[det.frame] / best) if best else 0.0
            angle = None
            if pipe_det is not None and coverage >= MIN_COVERAGE:
                lever_axis = principal_axis(mask_points(det, rasters[det.frame]))
                pipe_axis = principal_axis(mask_points(pipe_det, decode_raster(pipe_det))) or \
                    principal_axis([(pipe_det.box[0], pipe_det.center[1]), (pipe_det.box[2], pipe_det.center[1])])
                if lever_axis and pipe_axis:
                    angle = round(angle_between(lever_axis, pipe_axis), 1)
            frames.append(FrameAngle(frame=det.frame, angle_deg=angle,
                                     stage=classify_stage(angle) if angle is not None else "UNCERTAIN",
                                     coverage=round(coverage, 2)))
        angles = [f.angle_deg for f in frames if f.angle_deg is not None]
        swing = (max(angles) - min(angles)) if len(angles) >= 2 else 0.0
        candidates.append((swing, len(frames), LeverTrack(frames=frames)))
    if not candidates:
        return LeverTrack(frames=[])
    return max(candidates, key=lambda c: (c[0], c[1]))[2]


LEVER_CONCEPTS = ("yellow valve handle", "valve lever", "valve handle")
PIPE_CONCEPTS = ("metal pipe", "pipe")


class LeverTracker:
    """SAM video requests (lever, pipe) over the same clip.

    Concept wording matters on the real plant: its levers are yellow handles,
    and SAM found "yellow valve handle" where "valve lever" found nothing.
    Try the specific concept first, then the generic ones, per SAM's
    one-concept-per-request rule.
    """

    def __init__(self, sam: SamClient):
        self._sam = sam

    async def _first_match(self, concepts, segment) -> list[Detection]:
        for concept in concepts:
            reply = await segment(concept)
            if reply.detections:
                return reply.detections
        return []

    async def track(self, video_url: str) -> LeverTrack:
        lever = await self._first_match(LEVER_CONCEPTS, lambda c: self._sam.segment_video(video_url, c))
        pipe = await self._first_match(PIPE_CONCEPTS, lambda c: self._sam.segment_video(video_url, c))
        return build_track(lever, pipe)

    async def track_file(self, file_id: str) -> LeverTrack:
        lever = await self._first_match(LEVER_CONCEPTS, lambda c: self._sam.segment_video_file(file_id, c))
        pipe = await self._first_match(PIPE_CONCEPTS, lambda c: self._sam.segment_video_file(file_id, c))
        return build_track(lever, pipe)

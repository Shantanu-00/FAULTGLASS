"""Hand-driven lever motion from SAM video masks (deterministic code).

SAM 3.1 segments the valve handles, the hand and, when needed, a pipe. Plain
Python and Pillow then turn those masks into a timeline of lever movement.

What this proves:
- Hand contact: the dilated hand mask touches the handle mask.
- Timing: the handle the hand was on moved, or stood still, in each frame.
  Motion is the change of the lever pixels that the hand does not cover, so a
  hand re-gripping a still lever is not movement. When the fist hides the
  whole lever, the hand-and-handle grip point is used instead and the frame
  is marked low-confidence.
- Distinct rest positions: the median grip point of every still period, in
  coordinates corrected for camera movement, measured as a fraction of the
  lever length.

What this does not prove: no lever angle is measured and none is reported.
A handheld phone sees the lever in perspective and the fist covers most of
it, so an angle fit is not meaningful. Whether the valve ended fully closed
is checked later by the verifier on plant telemetry, not by video.

Camera movement is removed by aligning fixed objects between frames (handles
the hand never touches, or a pipe as fallback) with a translation-only mask
overlap search. Rotation and zoom of the phone are not modelled.
"""
from __future__ import annotations

import asyncio
import math
import statistics
from dataclasses import dataclass, field

from PIL import Image, ImageChops, ImageFilter, ImageStat

from .sam import Detection, SamClient, decode_raster

LEVER_CONCEPTS = ("yellow valve handle", "valve lever", "valve handle")
HAND_CONCEPTS = ("hand",)
PIPE_CONCEPTS = ("metal pipe", "pipe")

WORK_LONG_SIDE = 400          # working raster long side, px
HAND_MARGIN_PX = 3            # hand dilation at working scale
CONTACT_MIN_PX = 3            # dilated-hand pixels on the handle to count as contact
CONTACT_HOLD_S = 0.3          # contact gaps shorter than this are bridged
STITCH_GAP_FRAMES = 5         # a handle id that ends and a new one that starts this close is one handle
STITCH_BOX_MARGIN = 0.25      # box growth (fraction of size) when matching stitched ids
ALIGN_COARSE_FACTOR = 4
ALIGN_RADIUS_FRAC = 0.12      # per-frame camera search window, fraction of the working long side
KEYFRAME_MIN_OVERLAP = 0.6    # refresh the alignment keyframe below this overlap ratio
MOTION_SPAN_S = 0.2           # motion compares the frames this far before and after
MIN_VISIBLE_FRAC = 0.08       # visible lever pixels (vs largest handle mask) needed to judge motion
GRIP_NEAR_FRAC = 0.25         # hand pixels within this fraction of lever length belong to the grip
GRIP_SIGNAL_GAIN = 2.0        # grip displacement (fraction of lever length) to motion signal
SMOOTH_S = 0.5                # median window for the motion signal
MOVE_ENTER = 0.45             # smoothed motion to enter MOVING
MOVE_EXIT = 0.25              # smoothed motion to start leaving MOVING
MOVE_EXIT_HOLD_S = 0.5        # time below MOVE_EXIT before MOVING ends
MIN_MOVE_S = 0.3              # shorter moving runs are treated as noise
AMBIGUOUS_SCORE_RATIO = 0.5   # second handle with this share of moving frames makes the choice ambiguous


@dataclass
class Segment:
    kind: str  # still | moving
    start_s: float
    end_s: float
    first_index: int
    last_index: int

    @property
    def duration_s(self) -> float:
        return round(self.end_s - self.start_s, 2)

    def to_json(self) -> dict:
        return {"kind": self.kind, "start_s": round(self.start_s, 2), "end_s": round(self.end_s, 2),
                "duration_s": self.duration_s}


@dataclass
class MotionFrame:
    frame: int
    t_s: float
    seen: bool
    contact: bool
    moving: bool
    motion: float | None
    grip: tuple[float, float] | None
    tip_visible: bool
    aligned: bool
    low_confidence: bool

    def to_json(self) -> dict:
        return {"frame": self.frame, "t_s": round(self.t_s, 2), "contact": self.contact,
                "moving": self.moving, "motion": None if self.motion is None else round(self.motion, 3),
                "grip": None if self.grip is None else [round(self.grip[0], 1), round(self.grip[1], 1)],
                "low_confidence": self.low_confidence}


@dataclass
class LeverMotion:
    fps: float
    handle_seen: bool = False
    operated_ids: list[int] = field(default_factory=list)
    reference_ids: list[int] = field(default_factory=list)
    camera_reference: str = "none"  # handles | pipe | none
    ambiguous: bool = False
    contact_frames: int = 0
    frames: list[MotionFrame] = field(default_factory=list)
    segments: list[Segment] = field(default_factory=list)
    rest_positions: list[tuple[float, float]] = field(default_factory=list)
    lever_length_px: float = 0.0

    @property
    def movements(self) -> list[Segment]:
        return [s for s in self.segments if s.kind == "moving"]

    def coverage(self) -> dict:
        total = len(self.frames)
        seen = sum(1 for f in self.frames if f.seen)
        tip = sum(1 for f in self.frames if f.tip_visible)
        return {"frames": total, "lever_seen": seen, "tip_visible": tip,
                "lever_seen_ratio": round(seen / total, 2) if total else 0.0}

    def to_json(self) -> dict:
        return {"operated_ids": self.operated_ids, "reference_ids": self.reference_ids,
                "camera_reference": self.camera_reference, "ambiguous": self.ambiguous,
                "contact_frames": self.contact_frames, "fps": self.fps,
                "lever_length_px": round(self.lever_length_px, 1),
                "segments": [s.to_json() for s in self.segments],
                "rest_positions": [[round(x, 1), round(y, 1)] for x, y in self.rest_positions],
                "coverage": self.coverage(), "frames": [f.to_json() for f in self.frames]}


class _Canvas:
    """Working raster geometry shared by every mask of one clip."""

    def __init__(self, detections: list[Detection]):
        w = h = 1
        for det in detections:
            w = max(w, det.frame_size[0], det.box[2] + 1)
            h = max(h, det.frame_size[1], det.box[3] + 1)
        self.scale = min(1.0, WORK_LONG_SIDE / max(w, h))
        self.size = (max(1, round(w * self.scale)), max(1, round(h * self.scale)))

    def mask(self, dets: list[Detection]) -> Image.Image:
        """Union of the detections' box-local masks pasted at their box origins."""
        canvas = Image.new("L", self.size, 0)
        for det in dets:
            raster = decode_raster(det)
            x1, y1, x2, y2 = det.mask_bounds or det.box
            left, top = round(x1 * self.scale), round(y1 * self.scale)
            width = max(1, round((x2 - x1) * self.scale))
            height = max(1, round((y2 - y1) * self.scale))
            if raster and det.mask_w > 0 and det.mask_h > 0 and len(raster) >= det.mask_w * det.mask_h:
                local = Image.frombytes("L", (det.mask_w, det.mask_h), bytes(raster[:det.mask_w * det.mask_h]))
                local = local.point(lambda v: 255 if v else 0).resize((width, height), Image.NEAREST)
            else:
                local = Image.new("L", (width, height), 255)
            canvas.paste(255, (left, top), local)
        return canvas


def _count(img: Image.Image) -> int:
    return img.histogram()[255]


def _shift(img: Image.Image, dx: int, dy: int) -> Image.Image:
    """Move mask content by (dx, dy); content leaving the raster is dropped."""
    if dx == 0 and dy == 0:
        return img
    out = Image.new("L", img.size, 0)
    out.paste(img, (dx, dy))
    return out


def _centroid(img: Image.Image) -> tuple[float, float] | None:
    bbox = img.getbbox()
    if bbox is None:
        return None
    crop = img.crop(bbox)
    w, h = crop.size
    cols = crop.resize((w, 1), Image.BOX).tobytes()
    rows = crop.resize((1, h), Image.BOX).tobytes()
    cmass, rmass = sum(cols), sum(rows)
    if not cmass or not rmass:
        return None
    return (bbox[0] + 0.5 + sum(i * v for i, v in enumerate(cols)) / cmass,
            bbox[1] + 0.5 + sum(i * v for i, v in enumerate(rows)) / rmass)


def _boxes_near(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    mx = (a[2] - a[0]) * STITCH_BOX_MARGIN
    my = (a[3] - a[1]) * STITCH_BOX_MARGIN
    return not (b[0] > a[2] + mx or b[2] < a[0] - mx or b[1] > a[3] + my or b[3] < a[1] - my)


def stitch_tracks(detections: list[Detection]) -> list[dict[int, Detection]]:
    """Group detections by object id, joining an id that ends to one that starts at the same place."""
    by_id: dict[int, dict[int, Detection]] = {}
    for det in detections:
        track = by_id.setdefault(det.object_id, {})
        if det.frame not in track or det.area > track[det.frame].area:
            track[det.frame] = det
    chains: list[dict[int, Detection]] = []
    for track in sorted(by_id.values(), key=lambda t: min(t)):
        first = min(track)
        best = None
        for chain in chains:
            last = max(chain)
            if last < first and first - last <= STITCH_GAP_FRAMES and _boxes_near(chain[last].box, track[first].box):
                if best is None or last > max(best):
                    best = chain
        if best is not None:
            best.update(track)
        else:
            chains.append(dict(track))
    return chains


def _chain_ids(chain: dict[int, Detection]) -> list[int]:
    return sorted({d.object_id for d in chain.values()})


def _contact(handle: Image.Image, hand_dilated: Image.Image | None) -> bool:
    if hand_dilated is None:
        return False
    return _count(ImageChops.multiply(handle, hand_dilated)) >= CONTACT_MIN_PX


def _hand_masks(canvas: _Canvas, hands: list[Detection]) -> tuple[dict[int, Image.Image], dict[int, Image.Image]]:
    """Per-frame hand union masks: (raw, dilated by HAND_MARGIN_PX)."""
    grouped: dict[int, list[Detection]] = {}
    for det in hands:
        grouped.setdefault(det.frame, []).append(det)
    raw = {f: canvas.mask(dets) for f, dets in grouped.items()}
    size = 2 * HAND_MARGIN_PX + 1
    return raw, {f: img.filter(ImageFilter.MaxFilter(size)) for f, img in raw.items()}


def _split_chains(canvas: _Canvas, handles: list[Detection],
                  hand_masks: dict[int, Image.Image]) -> tuple[list, list]:
    """Stitched handle chains split into (touched by the hand, never touched by the hand)."""
    touched, untouched = [], []
    for chain in stitch_tracks(handles):
        hit = any(_contact(canvas.mask([d]), hand_masks.get(f)) for f, d in chain.items())
        (touched if hit else untouched).append(chain)
    return touched, untouched


def has_still_handle(handles: list[Detection], hands: list[Detection]) -> bool:
    """True when some handle is never touched by the hand and can serve as a fixed reference."""
    canvas = _Canvas(handles + hands)
    return bool(_split_chains(canvas, handles, _hand_masks(canvas, hands)[1])[1])


def _align(canvas: _Canvas, frames: list[int], references: dict[int, Image.Image]) -> dict[int, tuple[int, int, bool]]:
    """Camera offset per frame: aligned = raw - offset, found by mask overlap with a keyframe."""
    radius = max(2, round(ALIGN_RADIUS_FRAC * max(canvas.size)))
    f = ALIGN_COARSE_FACTOR
    offsets: dict[int, tuple[int, int, bool]] = {}
    key_img = key_small = None
    key_off = (0, 0)
    prev = (0, 0)
    for frame in frames:
        ref = references.get(frame)
        bbox = ref.getbbox() if ref is not None else None
        if bbox is None:
            offsets[frame] = (prev[0], prev[1], False)
            continue
        if key_img is None:
            key_img, key_small, key_off = ref, ref.reduce(f), prev
            offsets[frame] = (prev[0], prev[1], True)
            continue
        small = ref.reduce(f)
        sbox = small.getbbox() or (0, 0, small.size[0], small.size[1])
        crop = small.crop(sbox)
        cx = round((prev[0] - key_off[0]) / f)
        cy = round((prev[1] - key_off[1]) / f)
        r = max(1, radius // f)
        best = None
        for ry in range(cy - r, cy + r + 1):
            for rx in range(cx - r, cx + r + 1):
                window = key_small.crop((sbox[0] - rx, sbox[1] - ry, sbox[2] - rx, sbox[3] - ry))
                score = ImageStat.Stat(ImageChops.multiply(crop, window)).sum[0]
                rank = (score, -abs(rx - cx) - abs(ry - cy))
                if best is None or rank > best[0]:
                    best = (rank, rx, ry)
        fine = None
        rcrop = ref.crop(bbox)
        for ry in range(best[2] * f - f, best[2] * f + f + 1):
            for rx in range(best[1] * f - f, best[1] * f + f + 1):
                window = key_img.crop((bbox[0] - rx, bbox[1] - ry, bbox[2] - rx, bbox[3] - ry))
                score = _count(ImageChops.multiply(rcrop, window))
                if fine is None or score > fine[0]:
                    fine = (score, rx, ry)
        score, rx, ry = fine
        prev = (key_off[0] + rx, key_off[1] + ry)
        offsets[frame] = (prev[0], prev[1], True)
        if score < KEYFRAME_MIN_OVERLAP * _count(rcrop):
            key_img, key_small, key_off = ref, small, prev
    return offsets


def _median_filter(values: list[float | None], width: int) -> list[float | None]:
    half = width // 2
    out: list[float | None] = []
    for i in range(len(values)):
        window = [v for v in values[max(0, i - half): i + half + 1] if v is not None]
        out.append(statistics.median(window) if window else None)
    return out


def _hysteresis(signal: list[float | None], exit_frames: int) -> list[bool]:
    state, below = False, 0
    out: list[bool] = []
    for value in signal:
        if value is not None:
            if not state and value >= MOVE_ENTER:
                state, below = True, 0
            elif state and value < MOVE_EXIT:
                below += 1
                if below >= exit_frames:
                    state = False
                    for j in range(1, exit_frames):
                        out[-j] = False
            elif state:
                below = 0
        out.append(state)
    return out


def _segments(frames: list[MotionFrame], fps: float) -> list[Segment]:
    segments: list[Segment] = []
    for i, f in enumerate(frames):
        kind = "moving" if f.moving else "still"
        if segments and segments[-1].kind == kind:
            segments[-1].last_index = i
            segments[-1].end_s = f.t_s + 1 / fps
        else:
            segments.append(Segment(kind, f.t_s, f.t_s + 1 / fps, i, i))
    return segments


def _drop_short_moves(frames: list[MotionFrame], fps: float) -> None:
    for seg in _segments(frames, fps):
        if seg.kind == "moving" and seg.end_s - seg.start_s < MIN_MOVE_S - 1e-9:
            for f in frames[seg.first_index: seg.last_index + 1]:
                f.moving = False


def _analyse_chain(canvas: _Canvas, chain: dict[int, Detection], all_frames: list[int],
                   hand_raw: dict[int, Image.Image], hand_masks: dict[int, Image.Image],
                   offsets: dict[int, tuple[int, int, bool]], fps: float) -> tuple[list[MotionFrame], float]:
    masks = {f: canvas.mask([d]) for f, d in chain.items()}
    length = 0.0
    max_area = 0
    for img in masks.values():
        bbox = img.getbbox()
        if bbox:
            length = max(length, math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]))
            max_area = max(max_area, _count(img))
    near = max(1, round(GRIP_NEAR_FRAC * length))
    span = max(1, round(MOTION_SPAN_S * fps))
    hold = max(1, round(CONTACT_HOLD_S * fps))

    raw_contact = [f in masks and _contact(masks[f], hand_masks.get(f)) for f in all_frames]
    contact = [any(raw_contact[max(0, i - hold): i + hold + 1]) for i in range(len(all_frames))]

    grips: list[tuple[float, float] | None] = []
    for frame in all_frames:
        handle = masks.get(frame)
        if handle is None:
            grips.append(None)
            continue
        bbox = handle.getbbox()
        point_set = handle
        hand = hand_raw.get(frame)
        if hand is not None and bbox is not None:
            region = Image.new("L", canvas.size, 0)
            region.paste(255, (max(0, bbox[0] - near), max(0, bbox[1] - near),
                               min(canvas.size[0], bbox[2] + near), min(canvas.size[1], bbox[3] + near)))
            point_set = ImageChops.lighter(handle, ImageChops.multiply(hand, region))
        c = _centroid(point_set)
        dx, dy, _ = offsets[frame]
        grips.append(None if c is None else ((c[0] - dx) / canvas.scale, (c[1] - dy) / canvas.scale))

    empty = Image.new("L", canvas.size, 0)
    motions: list[float | None] = []
    tip_visible: list[bool] = []
    low: list[bool] = []
    signal: list[float | None] = []
    for i, frame in enumerate(all_frames):
        handle = masks.get(frame)
        visible = None
        if handle is not None:
            visible = ImageChops.subtract(handle, hand_masks.get(frame, empty))
        tip_visible.append(visible is not None and max_area > 0 and _count(visible) >= MIN_VISIBLE_FRAC * max_area)
        a, b = max(0, i - span), min(len(all_frames) - 1, i + span)
        fa, fb = all_frames[a], all_frames[b]
        motion = None
        if a != b and fa in masks and fb in masks:
            ox, oy, _ = offsets[fb]
            sx, sy = ox - offsets[fa][0], oy - offsets[fa][1]
            hand_b = hand_masks.get(fb, empty)
            hand_a = _shift(hand_masks.get(fa, empty), sx, sy)
            valid = ImageChops.invert(ImageChops.lighter(hand_a, hand_b))
            vis_b = ImageChops.multiply(masks[fb], valid)
            vis_a = ImageChops.multiply(_shift(masks[fa], sx, sy), valid)
            union = _count(ImageChops.lighter(vis_a, vis_b))
            if max_area > 0 and union >= MIN_VISIBLE_FRAC * max_area:
                motion = 1.0 - _count(ImageChops.multiply(vis_a, vis_b)) / union
        motions.append(motion)
        frame_low = not offsets[frame][2]
        value = motion
        if value is None and length > 0 and grips[a] is not None and grips[b] is not None:
            moved = math.dist(grips[a], grips[b]) * canvas.scale / length
            value = min(1.0, moved * GRIP_SIGNAL_GAIN)
            frame_low = True
        low.append(frame_low)
        signal.append(value)

    smooth = _median_filter(signal, max(3, round(SMOOTH_S * fps) | 1))
    moving = _hysteresis(smooth, max(1, round(MOVE_EXIT_HOLD_S * fps)))
    rows = [MotionFrame(frame=frame, t_s=frame / fps, seen=frame in masks, contact=contact[i],
                        moving=moving[i] and contact[i], motion=motions[i], grip=grips[i],
                        tip_visible=tip_visible[i], aligned=offsets[frame][2],
                        low_confidence=low[i] or not tip_visible[i])
            for i, frame in enumerate(all_frames)]
    _drop_short_moves(rows, fps)
    return rows, length / canvas.scale


def _rest_position(frames: list[MotionFrame]) -> tuple[float, float] | None:
    held = [f.grip for f in frames if f.grip is not None and f.contact] or \
           [f.grip for f in frames if f.grip is not None]
    if not held:
        return None
    return (statistics.median(p[0] for p in held), statistics.median(p[1] for p in held))


def build_lever_motion(handle_detections: list[Detection], hand_detections: list[Detection],
                       reference_detections: list[Detection], fps: float) -> LeverMotion:
    """Lever motion timeline from SAM detections of handles, hands and an optional fixed pipe."""
    result = LeverMotion(fps=fps, handle_seen=bool(handle_detections))
    if not handle_detections or fps <= 0:
        return result
    canvas = _Canvas(handle_detections + hand_detections + reference_detections)
    hand_raw, hand_masks = _hand_masks(canvas, hand_detections)
    touched, untouched = _split_chains(canvas, handle_detections, hand_masks)

    references: dict[int, list[Detection]] = {}
    if untouched:
        result.camera_reference = "handles"
        result.reference_ids = sorted({i for chain in untouched for i in _chain_ids(chain)})
        for chain in untouched:
            for f, det in chain.items():
                references.setdefault(f, []).append(det)
    elif reference_detections:
        result.camera_reference = "pipe"
        result.reference_ids = sorted({d.object_id for d in reference_detections})
        for det in reference_detections:
            references.setdefault(det.frame, []).append(det)

    all_frames = sorted({d.frame for d in handle_detections} | set(hand_raw))
    reference_masks = {f: canvas.mask(d) for f, d in references.items()}
    offsets = _align(canvas, all_frames, reference_masks)
    if not touched:
        return result

    scored = []
    for chain in touched:
        rows, length = _analyse_chain(canvas, chain, all_frames, hand_raw, hand_masks, offsets, fps)
        score = sum(1 for r in rows if r.moving)
        contacts = sum(1 for r in rows if r.contact)
        scored.append((score, contacts, chain, rows, length))
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    best = scored[0]
    if len(scored) > 1 and best[0] > 0 and scored[1][0] >= AMBIGUOUS_SCORE_RATIO * best[0]:
        result.ambiguous = True
    _, contacts, chain, rows, length = best
    result.operated_ids = _chain_ids(chain)
    result.contact_frames = contacts
    result.frames = rows
    result.lever_length_px = length
    result.segments = _segments(rows, fps)
    for seg in result.segments:
        if seg.kind == "still":
            pos = _rest_position(rows[seg.first_index: seg.last_index + 1])
            if pos is not None:
                result.rest_positions.append(pos)
    return result


class LeverTracker:
    """SAM video requests over one uploaded clip: handles and hand, then a pipe if no still handle exists.

    Concept wording matters on the real plant: its levers are yellow handles,
    and SAM found "yellow valve handle" where "valve lever" found nothing.
    Generic concepts are tried after the specific one, one concept per request.
    """

    def __init__(self, sam: SamClient):
        self._sam = sam

    async def _first_match(self, file_id: str, concepts: tuple[str, ...]) -> list[Detection]:
        for concept in concepts:
            reply = await self._sam.segment_video_file(file_id, concept)
            if reply.detections:
                return reply.detections
        return []

    async def track_file(self, file_id: str, fps: float) -> LeverMotion:
        handles, hands = await asyncio.gather(
            self._first_match(file_id, LEVER_CONCEPTS), self._first_match(file_id, HAND_CONCEPTS))
        pipes: list[Detection] = []
        if handles and not has_still_handle(handles, hands):
            pipes = await self._first_match(file_id, PIPE_CONCEPTS)
        return build_lever_motion(handles, hands, pipes, fps)

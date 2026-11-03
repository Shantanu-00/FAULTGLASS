"""Deterministic staged-travel policy for the V-113 backwash lever.

SAM supplies masks and lever.py turns them into a motion timeline; this module
decides whether the observed handling obeyed the staged rule: two separate
hand-driven movements with a hold of at least MIN_MID_HOLD_S between them.

What a pass proves: the hand was on the lever, the lever moved twice, it stood
still for the required hold between the movements, and it rested in three
distinct places (start, hold, end) with the hold position a real part of the
way. What it does not prove: no angle is measured, so the hold is not shown
to be at 45 degrees, and the closed end state is checked by the verifier on
plant telemetry, not by video. One continuous movement (straight from open to
closed) is the violation this guards against.

Start and end: the clip must begin and end with the lever at rest. A short
still period is enough (any length the tracker reports), because a clip that
starts or ends mid-movement leaves the first or last position unseen and is
reported uncertain, never passed.

It never trusts a claimed action and it cannot trigger the plant: the API
layer only records `backwash_completed` after this policy returns `passed`.
"""
from __future__ import annotations

import math
import statistics
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .lever import LeverMotion, LeverTracker
from .sam import SamClient

ANALYSIS_FPS = 10.0
ANALYSIS_HEIGHT = 540
MIN_MID_HOLD_S = 2.0
MIN_SEEN_RATIO = 0.5        # share of frames the operated lever must be seen in
MIN_REST_SEPARATION = 0.15  # rest positions must differ by this fraction of lever length
MIN_TRAVEL_SHARE = 0.25     # each movement must cover this share of the total travel
MAX_HOLD_DRIFT = 0.15       # grip drift across the hold, fraction of lever length
REQUIRED = f"two hand-driven movements separated by a hold of at least {MIN_MID_HOLD_S:g} s"


@dataclass(frozen=True)
class ValvePolicyResult:
    status: str  # passed | violated | uncertain
    reasons: list[str]
    movements: int = 0
    hold_s: float | None = None
    segments: list[dict] = field(default_factory=list)
    rest_separation: list[float] = field(default_factory=list)
    travel_split: list[float] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {"status": self.status, "reasons": self.reasons, "movements": self.movements,
                "hold_s": self.hold_s, "segments": self.segments,
                "rest_separation": self.rest_separation, "travel_split": self.travel_split,
                "required": REQUIRED, "min_hold_s": MIN_MID_HOLD_S}


def _drift(frames) -> float:
    """Distance between the median grip point of the first and last third of a still period."""
    grips = [f.grip for f in frames if f.grip is not None]
    if len(grips) < 3:
        return 0.0
    k = len(grips) // 3

    def median(points):
        return (statistics.median(p[0] for p in points), statistics.median(p[1] for p in points))
    return math.dist(median(grips[:k]), median(grips[-k:]))


def evaluate_lever_motion(motion: LeverMotion | None, fps: float | None) -> ValvePolicyResult:
    def result(status: str, reason: str, **extra) -> ValvePolicyResult:
        return ValvePolicyResult(status, [reason], movements=movements, segments=segments, **extra)

    movements = 0
    segments: list[dict] = []
    if not fps or fps <= 0:
        return result("uncertain", "The clip frame rate is unknown, so the hold cannot be timed.")
    if motion is None or not motion.handle_seen:
        return result("uncertain", "SAM did not find a valve handle in the clip.")
    if not motion.operated_ids or motion.contact_frames == 0:
        return result("uncertain", "The hand was never seen on a valve handle.")
    if motion.camera_reference == "none":
        return result("uncertain", "No fixed object in view to separate camera movement from lever movement.")
    if motion.ambiguous:
        return result("uncertain", "More than one handle moved under the hand; the operated lever is ambiguous.")
    segments = [s.to_json() for s in motion.segments]
    moves = motion.movements
    movements = len(moves)
    if motion.coverage()["lever_seen_ratio"] < MIN_SEEN_RATIO:
        return result("uncertain", "The operated lever was out of view for too much of the clip.")
    if movements == 0:
        return result("uncertain", "No hand-driven lever movement was seen.")
    if motion.segments[0].kind == "moving":
        return result("uncertain", "The clip starts while the lever is moving, so the start position was not seen.")
    if motion.segments[-1].kind == "moving":
        return result("uncertain", "The clip ends while the lever is moving, so the end position was not seen.")
    if movements == 1:
        return result("violated", "The lever moved in one continuous movement; no hold at a partial position was seen.")
    if movements > 2:
        return result("uncertain", f"The lever moved {movements} times; the staged rule expects exactly two movements. "
                                    "Stop recording once the lever is fully closed, before turning it back.")

    hold = motion.segments[2]
    hold_s = hold.duration_s
    if hold_s < MIN_MID_HOLD_S:
        return result("violated", f"The lever paused for about {hold_s:.1f} s between movements; "
                                  f"at least {MIN_MID_HOLD_S:g} s is required.", hold_s=hold_s)
    if len(motion.rest_positions) != 3 or motion.lever_length_px <= 0:
        return result("uncertain", "A rest position of the lever could not be located.", hold_s=hold_s)
    start, mid, end = motion.rest_positions
    length = motion.lever_length_px
    if _drift(motion.frames[hold.first_index: hold.last_index + 1]) / length > MAX_HOLD_DRIFT:
        return result("uncertain", "The lever crept during the pause, so it was not a clear hold.", hold_s=hold_s)
    separation = [round(math.dist(a, b) / length, 2) for a, b in ((start, mid), (mid, end), (start, end))]
    if min(separation) < MIN_REST_SEPARATION:
        return result("uncertain", "The start, hold and end positions of the lever were not clearly distinct.",
                      hold_s=hold_s, rest_separation=separation)
    first, second = math.dist(start, mid), math.dist(mid, end)
    split = [round(first / (first + second), 2), round(second / (first + second), 2)]
    if min(split) < MIN_TRAVEL_SHARE:
        return result("uncertain", "The first stop was not a partial turn.",
                      hold_s=hold_s, rest_separation=separation, travel_split=split)
    return ValvePolicyResult(
        "passed", [f"Two hand-driven movements with a {hold_s:.1f} s hold between them, "
                   "resting in three distinct positions."],
        movements=movements, hold_s=hold_s, segments=segments,
        rest_separation=separation, travel_split=split)


def normalize_clip(video_bytes: bytes, filename: str, mime_type: str,
                   fps: float | None) -> tuple[bytes, str, str, float | None]:
    """Downsample a phone clip to 10 fps / 540p without audio so SAM tracks it several times faster.

    A 14 s clip at 60 fps took about 8 minutes; the same clip at 10 fps takes about 75 s. Falls
    back to the original upload when ffmpeg is missing or fails.
    """
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        return video_bytes, filename, mime_type, fps
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / ("in" + Path(filename).suffix)
        target = Path(tmp) / "out.mp4"
        source.write_bytes(video_bytes)
        done = subprocess.run(
            [ffmpeg, "-loglevel", "error", "-y", "-i", str(source), "-an",
             "-vf", f"fps={ANALYSIS_FPS:g},scale=-2:'min({ANALYSIS_HEIGHT},ih)'",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", str(target)],
            capture_output=True, timeout=120)
        if done.returncode != 0 or not target.exists() or target.stat().st_size == 0:
            return video_bytes, filename, mime_type, fps
        return target.read_bytes(), "clip.mp4", "video/mp4", ANALYSIS_FPS


async def analyze_valve_clip(sam: SamClient, video_bytes: bytes, filename: str,
                             mime_type: str, *, fps: float | None = None) -> dict[str, Any]:
    """Upload once, track handles and hand with SAM, and apply the staged policy."""
    video_bytes, filename, mime_type, fps = normalize_clip(video_bytes, filename, mime_type, fps)
    if not fps or fps <= 0:
        return {"file_id": None, "track": None, "policy": evaluate_lever_motion(None, None).to_json()}
    file_id = await sam.upload_file(video_bytes, filename, mime_type)
    motion = await LeverTracker(sam).track_file(file_id, fps)
    policy = evaluate_lever_motion(motion, fps)
    return {"file_id": file_id, "track": motion.to_json(), "policy": policy.to_json()}

"""Deterministic staged-travel policy for the V-113 backwash lever.

SAM supplies masks; this module decides whether the observed movement obeyed
0 deg -> hold at 45 deg -> 90 deg. It never trusts a claimed action and it
cannot trigger the plant: the API layer only records `backwash_completed`
after this policy returns `passed`.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .lever import LeverTrack, LeverTracker, STAGE_BANDS
from .sam import SamClient

MIN_MID_HOLD_S = 2.0
MIN_MEASURED_RATIO = 0.60


@dataclass(frozen=True)
class ValvePolicyResult:
    status: str  # passed | violated | uncertain
    reasons: list[str]
    stages_seen: list[str]
    mid_hold_s: float | None
    measured_ratio: float

    def to_json(self) -> dict[str, Any]:
        return {"status": self.status, "reasons": self.reasons, "stages_seen": self.stages_seen,
                "mid_hold_s": self.mid_hold_s, "measured_ratio": self.measured_ratio,
                "required_sequence": ["OPEN", "MID", "CLOSED"], "stage_bands_deg": STAGE_BANDS}


def evaluate_lever_track(track: LeverTrack, *, fps: float | None = None) -> ValvePolicyResult:
    reasons: list[str] = []
    total = len(track.frames)
    measured = [f for f in track.frames if f.angle_deg is not None]
    measured_ratio = (len(measured) / total) if total else 0.0
    stages = track.stages_seen
    mid_frames = sum(1 for f in track.frames if f.stage == "MID")
    mid_hold_s = (mid_frames / fps) if fps and fps > 0 else None

    if total == 0 or not measured:
        return ValvePolicyResult("uncertain", ["SAM returned no measurable lever frames."],
                                 stages, mid_hold_s, measured_ratio)
    if measured_ratio < MIN_MEASURED_RATIO:
        reasons.append("Too many frames had low lever visibility to judge the movement.")
        return ValvePolicyResult("uncertain", reasons, stages, mid_hold_s, measured_ratio)
    if not stages or stages[0] != "OPEN":
        return ValvePolicyResult("uncertain", ["The starting OPEN position was not observed."],
                                 stages, mid_hold_s, measured_ratio)
    if "CLOSED" not in stages:
        return ValvePolicyResult("violated", ["The lever never reached the CLOSED stage."],
                                 stages, mid_hold_s, measured_ratio)
    if "MID" not in stages or stages.index("MID") > stages.index("CLOSED"):
        return ValvePolicyResult("violated", ["The lever moved to CLOSED without the required 45-degree stage."],
                                 stages, mid_hold_s, measured_ratio)
    if stages != ["OPEN", "MID", "CLOSED"]:
        return ValvePolicyResult("violated", [f"Unexpected stage sequence: {' -> '.join(stages)}."],
                                 stages, mid_hold_s, measured_ratio)
    if mid_hold_s is not None and mid_hold_s < MIN_MID_HOLD_S:
        return ValvePolicyResult(
            "violated", [f"MID stage held for about {mid_hold_s:.1f}s; at least {MIN_MID_HOLD_S:.0f}s is required."],
            stages, mid_hold_s, measured_ratio)
    if mid_hold_s is None and mid_frames < 3:
        return ValvePolicyResult("uncertain", ["MID stage was seen too briefly and clip fps was unavailable."],
                                 stages, mid_hold_s, measured_ratio)
    return ValvePolicyResult("passed", ["OPEN -> MID (held) -> CLOSED observed in order."],
                             stages, mid_hold_s, measured_ratio)


async def analyze_valve_clip(sam: SamClient, video_bytes: bytes, filename: str,
                             mime_type: str, *, fps: float | None = None) -> dict[str, Any]:
    """Upload once, track lever and pipe with SAM, and apply policy."""
    file_id = await sam.upload_file(video_bytes, filename, mime_type)
    track = await LeverTracker(sam).track_file(file_id)
    policy = evaluate_lever_track(track, fps=fps)
    return {"file_id": file_id, "track": track.to_json(), "policy": policy.to_json()}

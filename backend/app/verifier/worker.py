"""Deterministic incident verifier.

Only this Python worker closes a live incident, and only after an approved,
policy-passing valve action has been executed in the simulator. Models do not
participate in the verdict. The expected end state is partial recovery: the
simulator recovers to a 0.30 fouling residual, so FIT-301 should reach roughly
92% of baseline, not a falsely perfect 100%.
"""
from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass
from typing import Any

from ..plant.models import PlantPack
from ..repositories.investigation import InvestigationRepository
from ..repositories.runs import RunRepository
from ..repositories.telemetry import TelemetryRepository

log = logging.getLogger("verifier")

MEASUREMENTS = ("FIT-301", "PIT-301", "PIT-302", "JI-301", "AIT-301")
MIN_SETTLE_S = 20.0
TIMEOUT_S = 240.0
WINDOW_POINTS = 10


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def evaluate_recovery(
    *,
    nominals: dict[str, float],
    flag_current: dict[str, float],
    series: dict[str, list[float]],
    abnormal_states: list[str],
) -> dict[str, Any]:
    """Pure verdict over recent means. Returns pending/passed/failed + reasons."""
    means = {tag: _mean(values[-WINDOW_POINTS:]) for tag, values in series.items()}
    if any(means.get(tag) is None or len(series.get(tag, [])) < 5 for tag in MEASUREMENTS):
        return {"status": "pending", "means": means, "reasons": ["Waiting for a sustained telemetry window."]}
    if abnormal_states:
        return {"status": "failed", "means": means,
                "reasons": [f"Abnormal plant states present: {', '.join(abnormal_states)}."]}

    fit_base = nominals["FIT-301"]
    checks = {
        "FIT-301 recovered to at least 88% of baseline": means["FIT-301"] >= 0.88 * fit_base,
        "FIT-301 improved by at least 200 L/h from the flag": (
            means["FIT-301"] - flag_current.get("FIT-301", means["FIT-301"]) >= 200),
        "PIT-301 recovered near baseline": means["PIT-301"] >= nominals["PIT-301"] - 0.6,
        "PIT-302 recovered near baseline": means["PIT-302"] >= nominals["PIT-302"] - 4.0,
        "JI-301 recovered near baseline": means["JI-301"] >= nominals["JI-301"] - 1.0,
        "AIT-301 no longer elevated": means["AIT-301"] <= nominals["AIT-301"] + 1.5,
    }
    failed = [name for name, ok in checks.items() if not ok]
    return {
        "status": "passed" if not failed else "pending",
        "means": means,
        "fit_recovery_pct": round(means["FIT-301"] / fit_base * 100, 1) if fit_base else None,
        "reasons": failed or ["Sustained recovered telemetry window passed every threshold."],
    }


@dataclass(frozen=True)
class VerifierConfig:
    plant_id: str
    interval_s: float = 5.0


class IncidentVerifier:
    def __init__(self, pack: PlantPack, telemetry: TelemetryRepository,
                 investigation: InvestigationRepository, runs: RunRepository,
                 config: VerifierConfig):
        self._pack = pack
        self._telemetry = telemetry
        self._inv = investigation
        self._runs = runs
        self._config = config
        self._nominals = {
            i.tag: i.limits.nominal for i in pack.instruments
            if i.tag in MEASUREMENTS and i.limits and i.limits.nominal is not None
        }
        self._labels = {i.tag: (i.state_labels or {}) for i in pack.instruments}

    async def tick(self) -> list[str]:
        results = []
        for proposal in await self._inv.executed_proposals():
            try:
                results.append(await self.verify(proposal))
            except Exception:
                log.exception("verification failed for %s", proposal["incident_id"])
                results.append("error")
        return results

    async def verify(self, proposal: dict[str, Any]) -> str:
        incident_id = proposal["incident_id"]
        incident = await self._inv.incident(incident_id)
        if incident is None or incident["status"] != "open":
            return "already-closed"
        executed_at = proposal["executed_at"]
        elapsed = (dt.datetime.now(dt.timezone.utc) - executed_at).total_seconds()
        if elapsed < MIN_SETTLE_S:
            return "pending"

        flag = await self._inv.flag_for_incident(incident_id)
        run_id = flag["run_id"] if flag else None
        if run_id is None:
            return "no-run"
        rows = await self._telemetry.run_points(
            self._config.plant_id, run_id, executed_at, dt.datetime.now(dt.timezone.utc))
        series: dict[str, list[float]] = {}
        for row in rows:
            if row["tag"] in MEASUREMENTS and row["value"] is not None and row["quality"] == "good":
                series.setdefault(row["tag"], []).append(float(row["value"]))
        latest = {r["tag"]: r for r in await self._telemetry.latest(self._config.plant_id)}
        abnormal = []
        for tag, labels in self._labels.items():
            row = latest.get(tag)
            if row and row["value"] is not None:
                label = labels.get(str(int(row["value"])))
                if label and any(word in label for word in ("TRIP", "FAULT", "LOW_", "HIGH_")):
                    abnormal.append(f"{tag}={label}")
        flag_signals = ((flag or {}).get("evidence") or {}).get("signals") or {}
        flag_current = {
            tag: float(v["current"]) for tag, v in flag_signals.items()
            if isinstance(v, dict) and isinstance(v.get("current"), (int, float))
        }
        verdict = evaluate_recovery(
            nominals=self._nominals, flag_current=flag_current,
            series=series, abnormal_states=abnormal)

        if verdict["status"] == "passed":
            hypotheses = await self._inv.hypotheses(incident_id)
            supported = next((h for h in hypotheses if h["status"] in ("supported", "confirmed")), None)
            root_cause = (
                f"Likely: {supported['statement']}" if supported
                else "Likely restriction cleared by verified V-113 backwash")
            resolution = (
                f"Deterministic verifier: FIT-301 recovered to {verdict['fit_recovery_pct']}% of baseline "
                "after the staged V-113 backwash. Recovery is partial; replace the line 3 cartridge "
                "and inspect the sand filter for fines.")
            if await self._inv.resolve_incident(incident_id, root_cause=root_cause, resolution=resolution):
                await self._inv.add_trace(
                    incident_id, kind="verification", actor="verifier",
                    content=resolution, evidence=["FIT-301", "PIT-301", "PIT-302", "JI-301", "AIT-301"])
                checkpoint = await self._inv.checkpoint(incident_id)
                if checkpoint:
                    await self._inv.save_checkpoint(
                        incident_id, status="concluded", steps_used=checkpoint["steps_used"],
                        continuation=checkpoint["continuation"], focus=checkpoint["focus"],
                        model=checkpoint["model"])
                log.info("%s resolved by verifier", incident_id)
            return "resolved"

        if verdict["status"] == "failed" or elapsed > TIMEOUT_S:
            await self._inv.set_proposal_status(
                proposal["id"], "failed", result={"verdict": verdict, "elapsed_s": round(elapsed)})
            await self._inv.add_trace(
                incident_id, kind="verification", actor="verifier",
                content="Verification did not pass: " + "; ".join(verdict["reasons"]), evidence=["FIT-301"])
            checkpoint = await self._inv.checkpoint(incident_id)
            if checkpoint:
                await self._inv.save_checkpoint(
                    incident_id, status="escalated", steps_used=checkpoint["steps_used"],
                    continuation=checkpoint["continuation"], focus=checkpoint["focus"],
                    model=checkpoint["model"])
            return "failed"
        return "pending"

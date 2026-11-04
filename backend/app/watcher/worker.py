"""Spark watcher: reads stored telemetry, asks Spark, writes flags.

Data path (never the simulator directly):

    simulator -> Modbus -> edge -> POST /v1/ingest/telemetry -> Postgres
    Postgres (telemetry / telemetry_latest) -> this watcher -> summary card
    summary card -> Baseten Muse Spark Open -> NORMAL / WATCH / FLAG
    validated FLAG/WATCH -> signal_flags (+ a live incident on first FLAG)

The watcher only runs while a simulation run is `running`: before that the run
is still learning its baseline, and the card's baseline window is exactly that
learning window (sim_runs.started_at .. baseline_ready_at). It wakes every
`interval_s` (default 10 s, per docs/DEMO.md). A FLAG opens an incident so the
Wonder investigator has something durable to wake up on; Spark itself never
diagnoses and never closes anything.
"""
from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from ..observability import model_log_context, watcher_assessment, watcher_state
from ..plant.models import Instrument
from ..repositories.flags import FlagRepository
from ..repositories.runs import RunRepository, SimRun
from ..repositories.telemetry import TelemetryRepository
from .card import Card, build_card
from .spark import SparkReply, Verdict, check_against_card, parse_verdict

log = logging.getLogger("watcher")

RECENT_WINDOW_S = 30.0


class SparkClient(Protocol):
    @property
    def model(self) -> str: ...

    async def classify(self, card_text: str) -> SparkReply: ...


@dataclass(frozen=True)
class WatcherConfig:
    plant_id: str
    interval_s: float = 10.0
    recent_window_s: float = RECENT_WINDOW_S


def incident_id_for(run: SimRun) -> str:
    return f"INC-{run.started_at:%Y%m%d}-{run.id.hex[:6].upper()}"


class SparkWatcher:
    def __init__(
        self,
        runs: RunRepository,
        telemetry: TelemetryRepository,
        flags: FlagRepository,
        spark: SparkClient,
        instruments: list[Instrument],
        config: WatcherConfig,
    ):
        self._runs = runs
        self._telemetry = telemetry
        self._flags = flags
        self._spark = spark
        self._instruments = instruments
        self._config = config
        self._last_state: tuple[str, str | None] | None = None

    def _state(self, state: str, run: SimRun | None = None) -> None:
        identity = (state, str(run.id) if run else None)
        if identity != self._last_state:
            watcher_state(state, plant_id=self._config.plant_id, run_id=identity[1])
            self._last_state = identity

    def _assessment(self, run: SimRun, card: Card, verdict: Verdict,
                    outcome: str, validated: list[str], incident_id: str | None = None) -> None:
        known = {instrument.tag for instrument in self._instruments}
        watcher_assessment(
            plant_id=self._config.plant_id, run_id=run.id,
            incident_id=incident_id,
            verdict=verdict.verdict, outcome=outcome, validated_tags=[tag for tag in validated if tag in known],
            measurements={signal.tag: {"current": signal.current, "baseline": signal.baseline}
                          for signal in card.signals if signal.tag in known},
        )

    async def tick(self) -> str:
        """One watcher pass. Returns a short status string for logging/tests."""
        run = await self._runs.active(self._config.plant_id)
        if run is None:
            self._state("no-run")
            return "no-run"
        if run.status != "running" or run.baseline_ready_at is None:
            self._state(f"skipped-{run.status}", run)
            return f"skipped-{run.status}"
        card = await self._build_card(run)
        if not any(s.current is not None for s in card.signals):
            self._state("no-data", run)
            return "no-data"
        self._state("classifying", run)
        with model_log_context(plant_id=self._config.plant_id, run_id=run.id, purpose="telemetry_classification"):
            reply = await self._spark.classify(card.text())
        verdict = parse_verdict(reply.content, card)
        if verdict.verdict == "NORMAL":
            self._assessment(run, card, verdict, "normal", [])
            log.info("run %s NORMAL (%s ms)", run.id, reply.latency_ms)
            return "normal"
        validated, severity = check_against_card(verdict, card)
        if not validated or severity is None:
            self._assessment(run, card, verdict, "rejected", [])
            log.info("run %s %s rejected by card check (cited %s)", run.id, verdict.verdict, verdict.tags)
            return "rejected"
        existing_flag = await self._flags.open_flag_for(run.id, validated)
        if existing_flag:
            self._assessment(run, card, verdict, "duplicate", validated, existing_flag.get("incident_id"))
            log.info("run %s %s already flagged for %s", run.id, verdict.verdict, validated)
            return "duplicate"
        incident_id = None
        if verdict.verdict == "FLAG":
            incident_id = incident_id_for(run)
            title = f"Signal flag: {', '.join(validated)} drifted from baseline"
            await self._flags.ensure_incident(
                self._config.plant_id,
                incident_id,
                title=title,
                severity="high" if severity == "critical" else "medium",
                symptoms=[{"tag": t, "source": "spark_watcher"} for t in validated],
                models_used=[self._spark.model],
            )
        flag = await self._flags.create(
            self._config.plant_id,
            run_id=run.id,
            severity=severity,
            tags=validated,
            summary=verdict.summary,
            evidence=self._evidence(card, verdict, validated),
            model=self._spark.model,
            model_latency_ms=reply.latency_ms,
            incident_id=incident_id,
        )
        if incident_id:
            await self._flags.add_trace(
                incident_id,
                kind="alarm",
                actor="model",
                content=verdict.summary,
                evidence=validated,
                tool_name="spark_watcher",
            )
        log.info("run %s %s -> flag %s (%s, %s)", run.id, verdict.verdict, flag["id"], severity, validated)
        self._assessment(run, card, verdict, "flagged" if verdict.verdict == "FLAG" else "watched", validated, incident_id)
        return "flagged" if verdict.verdict == "FLAG" else "watched"

    async def _build_card(self, run: SimRun) -> Card:
        now = dt.datetime.now(dt.timezone.utc)
        baseline_rows = await self._telemetry.run_points(
            self._config.plant_id, run.id, run.started_at, run.baseline_ready_at
        )
        recent_rows = await self._telemetry.run_points(
            self._config.plant_id, run.id, now - dt.timedelta(seconds=self._config.recent_window_s), now
        )

        def group(rows) -> dict[str, list[float]]:
            out: dict[str, list[float]] = {}
            for row in rows:
                if row["value"] is not None and row["quality"] == "good":
                    out.setdefault(row["tag"], []).append(row["value"])
            return out

        latest = {row["tag"]: row for row in await self._telemetry.latest(self._config.plant_id)}
        states: dict[str, str] = {}
        stale: set[str] = set()
        for inst in self._instruments:
            if inst.observe != "telemetry":
                continue
            row = latest.get(inst.tag)
            if inst.type != "measurement":
                if row is not None and row["value"] is not None and inst.state_labels:
                    states[inst.tag] = inst.state_labels.get(str(int(row["value"])), str(row["value"]))
            elif row is not None and inst.freshness_s:
                age = (now - row["observed_at"]).total_seconds()
                if age > max(inst.freshness_s * 3, 10):
                    stale.add(inst.tag)
        return build_card(
            self._config.plant_id,
            str(run.id),
            self._instruments,
            group(baseline_rows),
            group(recent_rows),
            states,
            stale_tags=stale,
        )

    @staticmethod
    def _evidence(card: Card, verdict: Verdict, validated: list[str]) -> dict:
        by_tag = card.by_tag()
        return {
            "verdict": verdict.verdict,
            "cited_tags": verdict.tags,
            "validated_tags": validated,
            "signals": {
                tag: {
                    "current": round(by_tag[tag].current, 3),
                    "baseline": round(by_tag[tag].baseline, 3),
                    "pct": round(by_tag[tag].pct, 2),
                    "sigma": round(by_tag[tag].sigma, 2),
                    "unit": by_tag[tag].unit,
                }
                for tag in validated
                if tag in by_tag and by_tag[tag].current is not None
            },
        }

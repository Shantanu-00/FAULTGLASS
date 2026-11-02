"""Summary card: the only thing Muse Spark Open ever sees.

Deterministic code owns the numbers. For every streamed measurement it computes a
baseline (mean over the run's learning window, falling back to the pack nominal),
a spread (baseline standard deviation with a floor so quiet signals do not produce
huge sigma values), the recent mean, and the distance between them in percent and
in sigma. Spark judges this card; it never sees raw telemetry rows and it does
not diagnose (docs/DEMO.md, "Who does what").
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from ..plant.models import Instrument

ABNORMAL = re.compile(r"TRIP|FAULT|^LOW_|^HIGH_")

# Deterministic gates. Spark's verdict is only persisted for tags that clear
# these against the card, so a model claim the numbers do not support is dropped.
WATCH_SIGMA = 3.0
WATCH_PCT = 5.0
FLAG_SIGMA = 5.0
FLAG_PCT = 10.0


@dataclass(frozen=True)
class SignalCard:
    tag: str
    name: str
    unit: str
    current: float | None
    baseline: float | None
    spread: float | None
    delta: float | None
    pct: float | None
    sigma: float | None
    stale: bool = False

    @property
    def deviating(self) -> str | None:
        """'flag', 'watch', or None, judged by code alone."""
        if self.stale or self.sigma is None or self.pct is None:
            return None
        if abs(self.sigma) >= FLAG_SIGMA or abs(self.pct) >= FLAG_PCT:
            return "flag"
        if abs(self.sigma) >= WATCH_SIGMA or abs(self.pct) >= WATCH_PCT:
            return "watch"
        return None


@dataclass(frozen=True)
class StateCard:
    tag: str
    name: str
    label: str
    abnormal: bool


@dataclass(frozen=True)
class Card:
    plant_id: str
    run_id: str | None
    signals: list[SignalCard] = field(default_factory=list)
    states: list[StateCard] = field(default_factory=list)

    def by_tag(self) -> dict[str, SignalCard]:
        return {s.tag: s for s in self.signals}

    def text(self) -> str:
        lines = [f"Plant {self.plant_id} telemetry summary card (values computed by code, not by a model)."]
        lines.append("Measurements (current = recent mean, baseline = learning-window mean):")
        for s in self.signals:
            if s.current is None:
                lines.append(f"- {s.tag} {s.name}: no data")
                continue
            stale = " STALE" if s.stale else ""
            lines.append(
                f"- {s.tag} {s.name}: now {s.current:.2f} {s.unit}, baseline {s.baseline:.2f} {s.unit}, "
                f"delta {s.delta:+.2f} ({s.pct:+.1f}%), distance {s.sigma:+.1f} sigma, spread {s.spread:.3f}{stale}"
            )
        lines.append("States:")
        for s in self.states:
            mark = " ABNORMAL" if s.abnormal else ""
            lines.append(f"- {s.tag} {s.name}: {s.label}{mark}")
        return "\n".join(lines)


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _pstdev(values: list[float], mean: float) -> float:
    if len(values) < 2:
        return 0.0
    return math.sqrt(sum((v - mean) ** 2 for v in values) / len(values))


def build_card(
    plant_id: str,
    run_id: str | None,
    instruments: list[Instrument],
    baseline_points: dict[str, list[float]],
    recent_points: dict[str, list[float]],
    latest_states: dict[str, str],
    stale_tags: set[str] | None = None,
) -> Card:
    stale_tags = stale_tags or set()
    signals: list[SignalCard] = []
    states: list[StateCard] = []
    for inst in instruments:
        if inst.observe != "telemetry":
            continue
        if inst.type == "measurement":
            base_values = [v for v in baseline_points.get(inst.tag, []) if v is not None]
            recent_values = [v for v in recent_points.get(inst.tag, []) if v is not None]
            baseline = _mean(base_values)
            if baseline is None and inst.limits is not None:
                baseline = inst.limits.nominal
            current = _mean(recent_values)
            if baseline is None or current is None:
                signals.append(SignalCard(inst.tag, inst.name, inst.unit, current, baseline, None, None, None, None,
                                          stale=inst.tag in stale_tags))
                continue
            spread = _pstdev(base_values, baseline) if base_values else 0.0
            # Floor: at least 1% of baseline or 0.1% of range, so a quiet signal
            # cannot turn sensor noise into a 50-sigma claim.
            floor = max(abs(baseline) * 0.01, (inst.range[1] - inst.range[0]) * 0.001, 1e-9)
            spread = max(spread, floor)
            delta = current - baseline
            pct = (delta / baseline * 100.0) if baseline else 0.0
            signals.append(SignalCard(
                tag=inst.tag, name=inst.name, unit=inst.unit, current=current, baseline=baseline,
                spread=spread, delta=delta, pct=pct, sigma=delta / spread,
                stale=inst.tag in stale_tags,
            ))
        else:
            label = latest_states.get(inst.tag)
            if label is not None:
                states.append(StateCard(inst.tag, inst.name, label, bool(ABNORMAL.search(label))))
    return Card(plant_id=plant_id, run_id=run_id, signals=signals, states=states)

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from ..plant.models import Instrument

NOISE_TAU_S = 2.0

DECLINE_RAMP_S = 60.0
RECOVERY_RESIDUAL = 0.3
RECOVERY_DURATION_S = 30.0


@dataclass(frozen=True)
class AnalogProfile:
    noise: float
    effect: float


PROFILES: dict[str, AnalogProfile] = {
    "FIT-301": AnalogProfile(noise=15.0, effect=-500.0),
    "PIT-301": AnalogProfile(noise=0.1, effect=-0.9),
    "PIT-302": AnalogProfile(noise=0.5, effect=-6.0),
    "JI-301": AnalogProfile(noise=0.1, effect=-1.8),
    "AIT-301": AnalogProfile(noise=0.3, effect=2.0),
}

DISCRETE_BASELINE: dict[str, float] = {"FC-RO": 0.0}

PROTECTION: dict[str, tuple[str, str]] = {
    "PSL-301": ("PIT-301", "falling"),
    "PSH-301": ("PIT-302", "rising"),
}


class PlantModel:
    def __init__(self, instruments: list[Instrument], seed: int):
        self._rng = random.Random(seed)
        self._analog: dict[str, tuple[float, AnalogProfile]] = {}
        self._discrete: dict[str, float] = {}
        self._setpoints: dict[str, float] = {}
        for inst in instruments:
            if inst.observe != "telemetry":
                continue
            if inst.type == "measurement":
                profile = PROFILES.get(inst.tag)
                nominal = inst.limits.nominal if inst.limits else None
                if profile is None or nominal is None:
                    raise ValueError(f"{inst.tag}: no simulation profile or nominal value")
                self._analog[inst.tag] = (nominal, profile)
            else:
                self._discrete[inst.tag] = DISCRETE_BASELINE.get(inst.tag, 1.0)
                if inst.setpoint is not None:
                    self._setpoints[inst.tag] = inst.setpoint.value
        for tag, (source, _) in PROTECTION.items():
            if tag in self._discrete and source not in self._analog:
                raise ValueError(f"{tag}: protected signal {source} is not simulated")
        self._noise = {tag: 0.0 for tag in self._analog}
        self.fouling = 0.0
        self._target = 0.0
        self._rate = 0.0

    @property
    def phase(self) -> str:
        if math.isclose(self.fouling, self._target, abs_tol=1e-9):
            return "degraded" if self.fouling > 0 else "normal"
        return "declining" if self._target > self.fouling else "recovering"

    def start_decline(self, ramp_s: float = DECLINE_RAMP_S) -> None:
        self._retarget(1.0, ramp_s)

    def begin_recovery(self, residual: float = RECOVERY_RESIDUAL, duration_s: float = RECOVERY_DURATION_S) -> bool:
        if self.fouling <= residual:
            return False
        self._retarget(residual, duration_s)
        return True

    def step(self, dt: float) -> None:
        if dt <= 0:
            return
        remaining = self._target - self.fouling
        move = self._rate * dt
        self.fouling = self._target if abs(remaining) <= move else self.fouling + math.copysign(move, remaining)
        decay = math.exp(-dt / NOISE_TAU_S)
        scale = math.sqrt(1.0 - decay * decay)
        for tag, (_, profile) in self._analog.items():
            self._noise[tag] = self._noise[tag] * decay + profile.noise * scale * self._rng.gauss(0.0, 1.0)

    def readings(self) -> dict[str, float]:
        values = {
            tag: max(0.0, self._true_value(tag) + self._noise[tag]) for tag in self._analog
        }
        for tag, healthy in self._discrete.items():
            values[tag] = self._protection_state(tag, healthy)
        return values

    def _true_value(self, tag: str) -> float:
        nominal, profile = self._analog[tag]
        return nominal + profile.effect * self.fouling

    def _protection_state(self, tag: str, healthy: float) -> float:
        rule = PROTECTION.get(tag)
        setpoint = self._setpoints.get(tag)
        if rule is None or setpoint is None:
            return healthy
        source, direction = rule
        value = self._true_value(source)
        tripped = value < setpoint if direction == "falling" else value > setpoint
        return 0.0 if tripped else healthy

    def _retarget(self, target: float, duration_s: float) -> None:
        self._target = target
        self._rate = abs(target - self.fouling) / duration_s

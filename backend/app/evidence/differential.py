"""Cartridge bank differential pressure: inlet gauge minus outlet gauge.

The two gauges are read from two photos. Code, never the model, computes the difference and
decides whether it indicates a restricted bank. The V-113 backwash proposal is gated on it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

INLET_TAG = "PI-201"
OUTLET_TAG = "PI-202"
RESTRICTION_FACTOR = 1.5  # restricted when the differential reaches 1.5 x the normal differential
DEFAULT_NORMAL_DP_PSI = 8.0


@dataclass(frozen=True)
class Differential:
    inlet_psi: float
    outlet_psi: float
    dp_psi: float
    normal_dp_psi: float
    limit_dp_psi: float
    restricted: bool

    def to_json(self) -> dict[str, Any]:
        return {
            "inlet_tag": INLET_TAG, "outlet_tag": OUTLET_TAG,
            "inlet_psi": round(self.inlet_psi, 1), "outlet_psi": round(self.outlet_psi, 1),
            "dp_psi": round(self.dp_psi, 1), "normal_dp_psi": round(self.normal_dp_psi, 1),
            "limit_dp_psi": round(self.limit_dp_psi, 1), "restricted": self.restricted,
        }

    def summary(self) -> str:
        verdict = "RESTRICTED" if self.restricted else "within normal range"
        return (f"inlet {INLET_TAG} {self.inlet_psi:.1f} psi minus outlet {OUTLET_TAG} {self.outlet_psi:.1f} psi "
                f"= {self.dp_psi:.1f} psi differential; normal {self.normal_dp_psi:.1f} psi, restriction limit "
                f"{self.limit_dp_psi:.1f} psi -> {verdict}")


def normal_dp(instruments: Iterable[Any]) -> float:
    nominal = {i.tag: (i.limits.nominal if i.limits else None) for i in instruments if i.tag in (INLET_TAG, OUTLET_TAG)}
    if nominal.get(INLET_TAG) is not None and nominal.get(OUTLET_TAG) is not None:
        return float(nominal[INLET_TAG]) - float(nominal[OUTLET_TAG])
    return DEFAULT_NORMAL_DP_PSI


def compute_differential(readings: dict[str, float], instruments: Iterable[Any]) -> Differential | None:
    if INLET_TAG not in readings or OUTLET_TAG not in readings:
        return None
    normal = normal_dp(instruments)
    limit = normal * RESTRICTION_FACTOR
    dp = float(readings[INLET_TAG]) - float(readings[OUTLET_TAG])
    return Differential(float(readings[INLET_TAG]), float(readings[OUTLET_TAG]), dp, normal, limit, dp >= limit)

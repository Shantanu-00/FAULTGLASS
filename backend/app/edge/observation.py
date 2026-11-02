from __future__ import annotations

import datetime as dt
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Observation:
    tag: str
    observed_at: dt.datetime
    value: float | None
    raw_value: float | None
    unit: str
    quality: str

    def to_json(self) -> dict:
        data = asdict(self)
        data["observed_at"] = self.observed_at.isoformat()
        return data

    @classmethod
    def from_json(cls, data: dict) -> Observation:
        return cls(**{**data, "observed_at": dt.datetime.fromisoformat(data["observed_at"])})

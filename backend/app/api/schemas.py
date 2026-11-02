from __future__ import annotations

import datetime as dt
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

SCENARIO_NAME = "production_decline"
VALVE_ACTION = "backwash_completed"


class ReadingIn(BaseModel):
    tag: str
    observed_at: dt.datetime
    value: float | None = None
    raw_value: float | None = None
    unit: str | None = None
    quality: Literal["good", "bad", "stale", "uncertain"] = "good"

    @model_validator(mode="after")
    def check(self) -> ReadingIn:
        if self.observed_at.tzinfo is None:
            raise ValueError("observed_at must carry a timezone")
        if self.value is None and self.quality not in ("bad", "stale"):
            raise ValueError("a reading without a value must be marked bad or stale")
        return self


class IngestRequest(BaseModel):
    run_id: UUID | None = None
    readings: list[ReadingIn] = Field(min_length=1, max_length=1000)


class CreateRun(BaseModel):
    clock_speed: float = Field(default=1.0, ge=1.0, le=10.0)


class CompleteTaskIn(BaseModel):
    """Field-task completion (manual stub input; photo/SAM replaces the source later)."""

    readings: dict[str, float] = Field(default_factory=dict)
    note: str = Field(default="", max_length=1000)


class PhotoTaskIn(BaseModel):
    """Field-task completion from a photo: SAM + Wonder produce the readings."""

    image_base64: str = Field(min_length=100, max_length=30_000_000)
    note: str = Field(default="", max_length=1000)


class EventIn(BaseModel):
    kind: Literal["scenario", "valve_action"]
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def known_payload(self) -> EventIn:
        if self.kind == "scenario" and self.payload.get("name") != SCENARIO_NAME:
            raise ValueError(f"unknown scenario, expected name={SCENARIO_NAME}")
        if self.kind == "valve_action" and self.payload.get("action") != VALVE_ACTION:
            raise ValueError(f"unknown action, expected action={VALVE_ACTION}")
        return self

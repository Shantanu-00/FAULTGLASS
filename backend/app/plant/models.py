"""Typed plant pack. One pack describes a plant release: assets, pipes, instruments, data sources."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# How well an element is evidenced: seen in the footage, stated in the site description,
# normal practice for this kind of plant, or a placeholder that still needs checking.
Basis = Literal["footage", "description", "standard_practice", "assumed"]
# group = logical grouping with no ports, support = electrical/control equipment off the water path
Role = Literal["source", "sink", "process", "group", "support"]
Control = Literal["manual", "motorized", "automatic", "none"]
Medium = Literal[
    "raw", "pretreated", "chemical", "highpressure", "permeate", "reject", "pure",
    "backwash", "drain", "oxygen", "ozone_gas",
]
Protocol = Literal["modbus_tcp", "opcua", "mqtt", "manual"]
ValveState = Literal["open", "closed", "throttled"]


class Manifest(_Model):
    id: str
    name: str
    version: str
    data_origin: Literal["synthetic", "surveyed"]
    facility_id: str
    sections: dict[str, str]
    conventions: dict[str, str] = {}
    open_questions: list[str] = []
    not_modelled: list[str] = []


class Asset(_Model):
    id: str
    name: str
    kind: str
    section: str
    plan_item: str | None = None
    basis: Basis = "assumed"
    role: Role
    control: Control
    parent: str | None = None
    ports: dict[str, Literal["in", "out"]] = {}
    scene_node: str | None = None
    normal_state: dict[str, Any] | None = None
    spec: dict[str, Any] = {}


class Edge(_Model):
    id: str
    from_: str = Field(alias="from")
    to: str
    medium: Medium
    basis: Basis = "assumed"

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @staticmethod
    def split(ref: str) -> tuple[str, str]:
        asset, _, port = ref.partition(".")
        return asset, port


class Route(_Model):
    id: str
    name: str
    kind: Literal["duty", "standby", "bypass", "service", "backwash", "rinse"]
    from_: str = Field(alias="from")
    to: str
    edges: list[str]
    requires: dict[str, ValveState]

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class EdgeNode(_Model):
    id: str
    name: str


class ModbusAddress(_Model):
    table: Literal["input", "holding", "discrete", "coil"]
    offset: int = Field(ge=0)
    dtype: Literal["uint16", "int16", "float32", "bool"]


class OpcUaAddress(_Model):
    node_id: str


class MqttAddress(_Model):
    topic: str
    json_path: str | None = None


ADDRESS_MODELS: dict[str, type[_Model]] = {
    "modbus_tcp": ModbusAddress,
    "opcua": OpcUaAddress,
    "mqtt": MqttAddress,
}


class Source(_Model):
    id: str
    name: str
    protocol: Protocol
    edge_node: str | None
    poll_interval_s: float | None
    endpoint: dict[str, Any]
    credential_ref: str | None = None
    note: str | None = None


class Scaling(_Model):
    raw_min: float
    raw_max: float
    eng_min: float
    eng_max: float


class Limits(_Model):
    low_trip: float | None = None
    low_alarm: float | None = None
    nominal: float | None = None
    high_alarm: float | None = None
    high_trip: float | None = None

    @model_validator(mode="after")
    def ordered(self) -> "Limits":
        present = [
            v for v in (self.low_trip, self.low_alarm, self.nominal, self.high_alarm, self.high_trip)
            if v is not None
        ]
        if present != sorted(present):
            raise ValueError("limits must satisfy low_trip <= low_alarm <= nominal <= high_alarm <= high_trip")
        return self


class Setpoint(_Model):
    value: float
    unit: str
    direction: Literal["rising", "falling"]


class DisplayScale(_Model):
    """One printed scale on an analog dial. Dual-scale gauges print two."""
    unit: str
    min: float
    max: float
    color: str | None = None


class Attach(_Model):
    asset: str | None = None
    port: str | None = None
    edge: str | None = None
    span: tuple[str, str] | None = None

    @model_validator(mode="after")
    def exactly_one(self) -> "Attach":
        if sum(v is not None for v in (self.asset, self.port, self.edge, self.span)) != 1:
            raise ValueError("attach needs exactly one of asset, port, edge, span")
        return self


class Instrument(_Model):
    tag: str
    name: str
    type: Literal["measurement", "switch", "status"]
    quantity: str
    unit: str
    range: tuple[float, float]
    attach: Attach
    observe: Literal["telemetry", "field_photo"]
    basis: Basis = "assumed"
    display_scales: list[DisplayScale] | None = None
    source: str | None = None
    address: dict[str, Any] | None = None
    scaling: Scaling | None = None
    freshness_s: float | None = None
    limits: Limits | None = None
    setpoint: Setpoint | None = None
    state_labels: dict[str, str] | None = None
    location_note: str | None = None
    note: str | None = None


class Placement(_Model):
    x: float
    z: float
    rot_deg: float = 0
    row: str | None = None


class Layout(_Model):
    """Floor plan in metres. The 3D scene and the field map are rendered from this."""
    units: Literal["m"] = "m"
    approximate: bool = True
    floor: list[tuple[float, float]]
    zones: dict[str, str] = {}
    placements: dict[str, Placement]
    notes: list[str] = []


class PlantPack(_Model):
    manifest: Manifest
    layout: Layout | None = None
    assets: list[Asset]
    edges: list[Edge]
    routes: list[Route]
    edge_nodes: list[EdgeNode]
    sources: list[Source]
    instruments: list[Instrument]

    def asset(self, asset_id: str) -> Asset:
        return next(a for a in self.assets if a.id == asset_id)

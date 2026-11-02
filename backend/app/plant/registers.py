from __future__ import annotations

from dataclasses import dataclass

from .models import ModbusAddress, PlantPack, Scaling

TABLES = ("discrete", "coil", "input", "holding")


@dataclass(frozen=True)
class RegisterPoint:
    tag: str
    unit: str
    table: str
    offset: int
    dtype: str
    scaling: Scaling | None

    def decode(self, raw: int) -> float:
        if self.dtype == "bool":
            return float(raw & 1)
        if self.dtype == "int16" and raw >= 0x8000:
            raw -= 0x10000
        s = self.scaling
        if s is None:
            return float(raw)
        span = (s.eng_max - s.eng_min) / (s.raw_max - s.raw_min)
        return s.eng_min + (raw - s.raw_min) * span

    def encode(self, value: float) -> int:
        if self.dtype == "bool":
            return 1 if value >= 0.5 else 0
        s = self.scaling
        raw = value if s is None else s.raw_min + (value - s.eng_min) * (s.raw_max - s.raw_min) / (s.eng_max - s.eng_min)
        if self.dtype == "int16":
            return max(-0x8000, min(0x7FFF, round(raw))) & 0xFFFF
        return max(0, min(0xFFFF, round(raw)))


@dataclass(frozen=True)
class RegisterPlan:
    source_id: str
    unit_id: int
    points: tuple[RegisterPoint, ...]

    def tables(self) -> dict[str, list[RegisterPoint]]:
        grouped: dict[str, list[RegisterPoint]] = {}
        for p in sorted(self.points, key=lambda p: (p.table, p.offset)):
            grouped.setdefault(p.table, []).append(p)
        return grouped

    def size(self, table: str) -> int:
        return max((p.offset + 1 for p in self.points if p.table == table), default=0)

    def tag_index(self) -> dict[str, RegisterPoint]:
        return {p.tag: p for p in self.points}


def build_plan(pack: PlantPack, source_id: str) -> RegisterPlan:
    source = next((s for s in pack.sources if s.id == source_id), None)
    if source is None or source.protocol != "modbus_tcp":
        raise ValueError(f"{source_id} is not a Modbus TCP source in this pack")
    points = []
    for inst in pack.instruments:
        if inst.observe != "telemetry" or inst.source != source_id:
            continue
        address = ModbusAddress.model_validate(inst.address)
        if address.dtype == "float32":
            raise NotImplementedError(f"{inst.tag}: float32 registers are not supported")
        points.append(RegisterPoint(
            tag=inst.tag, unit=inst.unit, table=address.table, offset=address.offset,
            dtype=address.dtype, scaling=inst.scaling,
        ))
    seen: set[tuple[str, int]] = set()
    for p in points:
        key = (p.table, p.offset)
        if key in seen:
            raise ValueError(f"{p.tag}: register {p.table}[{p.offset}] is used twice")
        seen.add(key)
    return RegisterPlan(source_id=source_id, unit_id=int(source.endpoint.get("unit_id", 1)), points=tuple(points))

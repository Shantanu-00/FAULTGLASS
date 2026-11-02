"""What the investigator is told about the plant: topology plus an honest map of what is
streamed, what is only visible on site, and which assets are blind."""
from __future__ import annotations

from typing import Any

from .models import Edge, Instrument, PlantPack

_FITTING_KINDS = {"tee", "valve", "drain", "header"}


def _points(pack: PlantPack, asset_id: str) -> set[str]:
    """Tags measuring this asset directly, at one of its ports, or on a pipe touching it."""
    a = pack.asset(asset_id)
    edge_ids = {
        e.id for e in pack.edges
        if asset_id in (Edge.split(e.from_)[0], Edge.split(e.to)[0])
    }
    found: set[str] = set()
    for i in pack.instruments:
        t = i.attach
        if t.asset == asset_id or (t.edge and t.edge in edge_ids):
            found.add(i.tag)
        elif t.port and Edge.split(t.port)[0] == asset_id and Edge.split(t.port)[1] in a.ports:
            found.add(i.tag)
        elif t.span and any(Edge.split(s)[0] == asset_id for s in t.span):
            found.add(i.tag)
    return found


def _nearby(pack: PlantPack, asset_id: str, hops: int = 2) -> tuple[set[str], set[str]]:
    """(fittings, equipment) reached from an asset through at most `hops` fittings.

    Fittings (tees, valves, headers) are transparent; the first piece of real equipment on
    each side is returned separately because its instruments are indirect evidence."""
    seen, frontier = {asset_id}, {asset_id}
    kinds = {a.id: a.kind for a in pack.assets}
    equipment: set[str] = set()
    for _ in range(hops + 1):
        step: set[str] = set()
        for e in pack.edges:
            a, b = Edge.split(e.from_)[0], Edge.split(e.to)[0]
            for x, y in ((a, b), (b, a)):
                if x in frontier and y not in seen:
                    (step if kinds[y] in _FITTING_KINDS else equipment).add(y)
        seen |= step
        frontier = step
    return seen - {asset_id}, equipment - {asset_id}


def observability(pack: PlantPack) -> dict[str, Any]:
    by_tag: dict[str, Instrument] = {i.tag: i for i in pack.instruments}
    telemetry = [t for t, i in by_tag.items() if i.observe == "telemetry"]
    field = [t for t, i in by_tag.items() if i.observe == "field_photo"]
    manual_valves = [a.id for a in pack.assets if a.kind == "valve" and a.control == "manual"]
    blind = []
    for a in pack.assets:
        if a.role in ("group", "support", "source", "sink") or a.kind in _FITTING_KINDS:
            continue
        pts = _points(pack, a.id)
        if not any(by_tag[t].observe == "telemetry" for t in pts):
            fittings, neighbours = _nearby(pack, a.id)
            near = set().union(*(_points(pack, n) for n in fittings), set()) - pts
            near |= {t for n in neighbours for t in _points(pack, n) if by_tag[t].observe == "telemetry"}
            blind.append({
                "asset": a.id,
                "nearby_streamed": sorted(t for t in near if by_tag[t].observe == "telemetry"),
                "nearby_field": sorted(t for t in near | pts if by_tag[t].observe == "field_photo"),
            })
    return {
        "streamed": telemetry,
        "field_only": field,
        "manual_valves": manual_valves,
        "blind_assets": blind,
    }


def summary(pack: PlantPack) -> str:
    o = observability(pack)
    by_tag = {i.tag: i for i in pack.instruments}
    src = {s.id: s for s in pack.sources}
    lines = [f"{pack.manifest.name}  v{pack.manifest.version}  [{pack.manifest.data_origin}]",
             f"{len(pack.assets)} assets, {len(pack.edges)} pipes, {len(pack.instruments)} instruments, "
             f"{len(pack.routes)} routes", "", "STREAMED (edge -> API):"]
    for t in o["streamed"]:
        i = by_tag[t]
        lines.append(f"  {t:8} {i.quantity:20} {i.unit:6} via {src[i.source].protocol}")
    lines += ["", "NO API (a person must look):"]
    for t in o["field_only"]:
        lines.append(f"  {t:8} {by_tag[t].quantity:20} {by_tag[t].unit:6} {by_tag[t].location_note}")
    lines += ["", "MANUAL VALVES: " + ", ".join(o["manual_valves"]), "",
              "BLIND ASSETS (no streamed signal of their own; indirect evidence nearby):"]
    for b in o["blind_assets"]:
        lines.append(f"  {b['asset']:8} streamed nearby: {', '.join(b['nearby_streamed']) or '-':22} "
                     f"field nearby: {', '.join(b['nearby_field']) or '-'}")
    return "\n".join(lines)

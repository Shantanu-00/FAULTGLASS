"""Cross-reference and topology checks for a plant pack. Returns every problem, not just the first."""
from __future__ import annotations

from collections import defaultdict

from pydantic import ValidationError

from .models import ADDRESS_MODELS, Edge, PlantPack


def _dupes(ids: list[str]) -> set[str]:
    return {i for i in ids if ids.count(i) > 1}


def validate_pack(p: PlantPack) -> list[str]:
    errors: list[str] = []
    assets = {a.id: a for a in p.assets}
    edges = {e.id: e for e in p.edges}
    sources = {s.id: s for s in p.sources}
    edge_nodes = {n.id for n in p.edge_nodes}

    for label, ids in (
        ("asset", [a.id for a in p.assets]),
        ("edge", [e.id for e in p.edges]),
        ("route", [r.id for r in p.routes]),
        ("source", [s.id for s in p.sources]),
        ("instrument", [i.tag for i in p.instruments]),
    ):
        for d in sorted(_dupes(ids)):
            errors.append(f"duplicate {label} id {d}")

    # ---- assets ----
    for a in p.assets:
        if a.section not in p.manifest.sections:
            errors.append(f"asset {a.id}: unknown section {a.section}")
        if a.parent and a.parent not in assets:
            errors.append(f"asset {a.id}: unknown parent {a.parent}")
        if a.role in ("group", "support") and a.ports:
            errors.append(f"asset {a.id}: {a.role} assets carry no ports")
        if a.role not in ("group", "support") and not a.ports:
            errors.append(f"asset {a.id}: no ports")
        if a.kind == "valve" and a.control == "manual" and not a.normal_state:
            errors.append(f"asset {a.id}: manual valve needs normal_state")

    # ---- pipes ----
    used: dict[tuple[str, str], str] = {}
    out_of: dict[str, set[str]] = defaultdict(set)
    for e in p.edges:
        for end, ref, want in (("from", e.from_, "out"), ("to", e.to, "in")):
            aid, port = Edge.split(ref)
            asset = assets.get(aid)
            if asset is None:
                errors.append(f"edge {e.id}: unknown asset {aid} in {end}")
                continue
            direction = asset.ports.get(port)
            if direction is None:
                errors.append(f"edge {e.id}: {aid} has no port {port}")
            elif direction != want:
                errors.append(f"edge {e.id}: {ref} is an {direction} port but used as {end}")
            if (aid, port) in used:
                errors.append(f"edge {e.id}: port {ref} already used by {used[(aid, port)]}")
            used[(aid, port)] = e.id
        out_of[Edge.split(e.from_)[0]].add(Edge.split(e.to)[0])
    for a in p.assets:
        for port in a.ports:
            if (a.id, port) not in used:
                errors.append(f"asset {a.id}: port {port} is not connected")

    # flow reachability: every process asset is fed by a source and drains to a sink
    flowing = [a.id for a in p.assets if a.role not in ("group", "support")]
    reach_fwd = _reach({a.id for a in p.assets if a.role == "source"}, out_of)
    into: dict[str, set[str]] = defaultdict(set)
    for src, dsts in out_of.items():
        for d in dsts:
            into[d].add(src)
    reach_back = _reach({a.id for a in p.assets if a.role == "sink"}, into)
    for aid in flowing:
        if aid not in reach_fwd:
            errors.append(f"asset {aid}: not reachable from any source")
        if aid not in reach_back:
            errors.append(f"asset {aid}: does not drain to any sink")

    # ---- routes ----
    for r in p.routes:
        unknown = [x for x in r.edges if x not in edges]
        if unknown:
            errors.append(f"route {r.id}: unknown edges {unknown}")
            continue
        succ: dict[str, set[str]] = defaultdict(set)
        pred: dict[str, set[str]] = defaultdict(set)
        for x in r.edges:
            a, b = Edge.split(edges[x].from_)[0], Edge.split(edges[x].to)[0]
            succ[a].add(b)
            pred[b].add(a)
        fwd, back = _reach({r.from_}, succ), _reach({r.to}, pred)
        for x in r.edges:
            a, b = Edge.split(edges[x].from_)[0], Edge.split(edges[x].to)[0]
            if a not in fwd or b not in back:
                errors.append(f"route {r.id}: edge {x} is not on a path {r.from_} -> {r.to}")
        for aid in r.requires:
            if aid not in assets or assets[aid].control != "manual":
                errors.append(f"route {r.id}: requires {aid}, which is not a manual valve in the pack")

    # ---- layout ----
    if p.layout:
        placed = set(p.layout.placements)
        for aid in placed - set(assets):
            errors.append(f"layout: placement for unknown asset {aid}")
        for a in p.assets:
            if a.role != "group" and a.id not in placed:
                errors.append(f"layout: asset {a.id} has no placement")
        if not _inside_floor(p.layout):
            errors.append("layout: some placements fall outside the floor polygon")

    # ---- sources ----
    for s in p.sources:
        if s.protocol == "manual":
            if s.edge_node:
                errors.append(f"source {s.id}: manual sources have no edge node")
        elif s.edge_node not in edge_nodes:
            errors.append(f"source {s.id}: unknown edge node {s.edge_node}")
        elif s.poll_interval_s is None:
            errors.append(f"source {s.id}: poll_interval_s required")

    # ---- instruments ----
    registers: dict[tuple, str] = {}
    for i in p.instruments:
        t = i.tag
        if i.range[0] >= i.range[1]:
            errors.append(f"instrument {t}: empty range")
        errors += [f"instrument {t}: {m}" for m in _check_attach(i, assets, edges)]
        if i.limits:
            for k, v in i.limits.model_dump(exclude_none=True).items():
                if not i.range[0] <= v <= i.range[1]:
                    errors.append(f"instrument {t}: limit {k}={v} outside range {list(i.range)}")
        if i.type in ("switch", "status") and not i.state_labels:
            errors.append(f"instrument {t}: {i.type} needs state_labels")
        if i.setpoint and i.type != "switch":
            errors.append(f"instrument {t}: setpoint only applies to switches")
        if i.observe == "field_photo":
            if i.source or i.address or i.scaling:
                errors.append(f"instrument {t}: field_photo instruments have no source, address or scaling")
            if not i.location_note:
                errors.append(f"instrument {t}: field_photo needs location_note so a person can find it")
            continue
        src = sources.get(i.source or "")
        if src is None or src.protocol == "manual":
            errors.append(f"instrument {t}: telemetry needs a streaming source, got {i.source}")
            continue
        if i.freshness_s is None:
            errors.append(f"instrument {t}: telemetry needs freshness_s")
        model = ADDRESS_MODELS[src.protocol]
        try:
            addr = model.model_validate(i.address or {})
        except ValidationError as exc:
            errors.append(f"instrument {t}: bad {src.protocol} address: {exc.errors()[0]['msg']}")
            continue
        if src.protocol == "modbus_tcp":
            key = (src.id, addr.table, addr.offset)
            if key in registers:
                errors.append(f"instrument {t}: modbus offset {key} already used by {registers[key]}")
            registers[key] = t
            if addr.dtype in ("uint16", "int16") and i.type == "measurement" and not i.scaling:
                errors.append(f"instrument {t}: 16-bit counts need scaling")
    return errors


def _check_attach(i, assets, edges) -> list[str]:
    a = i.attach
    out: list[str] = []
    refs = [a.port] if a.port else list(a.span or ())
    for ref in refs:
        aid, _, port = ref.partition(".")
        if aid not in assets or port not in assets[aid].ports:
            out.append(f"attach target {ref} does not exist")
    if a.asset and a.asset not in assets:
        out.append(f"attach asset {a.asset} does not exist")
    if a.edge and a.edge not in edges:
        out.append(f"attach edge {a.edge} does not exist")
    return out


def _reach(start: set[str], graph: dict[str, set[str]]) -> set[str]:
    seen, stack = set(start), list(start)
    while stack:
        for nxt in graph.get(stack.pop(), ()):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def _inside_floor(layout) -> bool:
    """Ray-casting point-in-polygon for every placement. Boundary sources/sinks may sit outside
    on purpose, so they are exempt via row == 'outside'."""
    poly = layout.floor
    for pl in layout.placements.values():
        if pl.row == "outside":
            continue
        x, z, inside = pl.x, pl.z, False
        for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
            if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
                inside = not inside
        if not inside:
            return False
    return True

"""Plant memory: the text blocks injected into the AI's context when an incident opens.

Generated from a validated PlantPack, so every value stated here is in the pack. Four blocks
(topology, observability, human_tasks, floor_plan) plus a short glossary of tag prefixes.
Plain markdown; each block is kept under BLOCK_LIMIT characters."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

from .briefing import observability
from .models import Asset, Edge, Instrument, PlantPack

BLOCK_LIMIT = 6000

BASIS_CODE = {"footage": "F", "description": "D", "standard_practice": "S", "assumed": "A"}
BASIS_LEGEND = "Basis: F footage, D description, S standard practice, A assumed (check on site)."

KIND_LETTER = {
    "supply": "S", "tank": "T", "pump": "P", "media_vessel": "M", "tee": "+", "prefilter": "Q",
    "header": "=", "cartridge_housing": "C", "ro_vessel_bank": "R", "valve": "v", "drain": "D",
    "mcc": "E", "hmi_plc": "H", "ozone_generator": "Z", "oxygen_concentrator": "O",
    "injector": "I", "polish_filter": "U", "filler": "X",
}

# Meaning of each tag or asset-id prefix. Every prefix in the pack must appear here (checked).
PREFIX_MEANING = {
    "AIT": "analyser indicating transmitter (RO permeate TDS, ppm)",
    "BW": "borewell supply line (boundary)",
    "CB": "fine cartridge housing (4 lines, front then back)",
    "DRN": "drain (trench manifold or RO reject drain)",
    "E": "pipe (edge), e.g. E-M102",
    "FC": "RO fault code (PLC)",
    "FI": "flow indicator, vertical rotameter (L/h)",
    "FIT": "flow indicating transmitter (RO permeate flow, L/h)",
    "JI": "current indicator (HP pump motor current, A)",
    "FILL": "filler / bottling line (outside the building outline)",
    "HDR": "header manifold for the cartridge bank",
    "HMI": "HMI/PLC operator console",
    "LSH": "level switch, high",
    "LSL": "level switch, low",
    "MCC": "motor control centre (corner power panel)",
    "MGF": "sand / dual-media filter vessel",
    "ACF": "activated carbon filter vessel",
    "SOF": "water softener vessel",
    "NV": "needle valve (RO reject, throttled)",
    "OC": "oxygen concentrator",
    "OZ": "ozone generator",
    "P": "pump",
    "PF": "filter (PF-101 coarse pre-filter, PF-401 inline trap filter)",
    "PI": "pressure indicator, dial gauge (psi scale)",
    "PIT": "pressure indicating transmitter (HP pump suction and discharge, psi)",
    "PSH": "pressure switch, high (trip)",
    "PSL": "pressure switch, low (trip)",
    "RO": "reverse osmosis membrane array",
    "ST": "RO cycle state (PLC)",
    "TB": "tee, outlet split (service and rinse outlets)",
    "TF": "tee, feed split (service and backwash outlets)",
    "TK": "tank",
    "V": "valve (lever valve, see manual valves)",
    "VI": "ozone venturi injector",
    "YS": "run state (pump running feedback)",
}


@dataclass(frozen=True)
class MemoryBlock:
    kind: str
    title: str
    body_md: str


def _clean(name: str) -> str:
    """Strip micron ratings from names: cartridge and filter ratings are not stated on screen."""
    return re.sub(r"\s*\d+(?:\.\d+)?\s*micron\b", "", name, flags=re.IGNORECASE).strip()


def _prefix(tag: str) -> str:
    return tag.split("-", 1)[0]


def _ref(pack: PlantPack, ref: str) -> str:
    """asset.port, with the port shown only where it matters (vessels, tees, headers)."""
    asset, port = Edge.split(ref)
    if set(pack.asset(asset).ports) <= {"in", "out"}:
        return asset
    return f"{asset}.{port}"


def _header(pack: PlantPack, simulated_note: bool = True) -> str:
    m = pack.manifest
    head = f"Plant {m.id}: {m.name}, v{m.version}, data {m.data_origin}."
    if simulated_note:
        head += " Telemetry values are SIMULATED; the real HMI/PLC was not identified."
    return head


def _addr(i: Instrument, sources: dict) -> str:
    src = i.source
    proto = sources[src].protocol if src in sources else "?"
    a = i.address or {}
    if proto == "modbus_tcp":
        where = f"{a.get('table')} offset {a.get('offset')} {a.get('dtype')}"
    elif proto == "opcua":
        where = f"node {a.get('node_id')}"
    elif proto == "mqtt":
        where = f"topic {a.get('topic')}"
    else:
        where = "field entry"
    return f"{src} {proto} {where}"


def topology_block(pack: PlantPack) -> str:
    edges = {e.id: e for e in pack.edges}
    lines = [_header(pack, simulated_note=False), BASIS_LEGEND,
             "Format: ID [basis] name | kind | control (manual, motorized, automatic, none).", ""]
    for sec_id, sec_text in pack.manifest.sections.items():
        lines.append(f"## Section {sec_id}: {sec_text}")
        for a in pack.assets:
            if a.section == sec_id:
                lines.append(f"- {a.id} [{BASIS_CODE[a.basis]}] {_clean(a.name)} | {a.kind} | {a.control}")
        lines.append("")

    lines.append("## Routes (named alternative paths, pipes in flow order; valve states under human tasks)")
    on_route: set[str] = set()
    for r in pack.routes:
        on_route |= set(r.edges)
        lines.append(f"- {r.id}:")
        chain = []
        for eid in r.edges:
            e = edges[eid]
            chain.append(f"{eid} {_ref(pack, e.from_)}>{_ref(pack, e.to)}")
        lines.append("  " + "; ".join(chain))
    lines.append("")
    lines.append("## Pipes not on any route (file order, roughly upstream to downstream)")
    rest = []
    for e in pack.edges:
        if e.id in on_route:
            continue
        rest.append(f"{e.id} {_ref(pack, e.from_)}>{_ref(pack, e.to)}")
    lines.append("; ".join(rest))
    return "\n".join(lines).rstrip() + "\n"


def observability_block(pack: PlantPack) -> str:
    o = observability(pack)
    by_tag = {i.tag: i for i in pack.instruments}
    sources = {s.id: s for s in pack.sources}
    lines = [_header(pack), "",
             "Streamed points come from the HMI/PLC through the edge node. Field points have no API:",
             "a person reads them on site and the value arrives as a field entry.", "",
             "## STREAMED (edge -> API)"]
    for t in o["streamed"]:
        i = by_tag[t]
        labels = ""
        if i.state_labels:
            labels = "; states " + ", ".join(f"{k}={v}" for k, v in i.state_labels.items())
        fresh = f"; fresh within {i.freshness_s:g} s" if i.freshness_s else ""
        lines.append(f"- {t} {i.quantity} ({i.unit}) on {i.attach.asset or i.attach.port or i.attach.edge}: "
                     f"{_addr(i, sources)}{fresh}{labels}")
    lines += ["", "## NO API (a person must look)"]
    for t in o["field_only"]:
        i = by_tag[t]
        lines.append(f"- {t} {i.quantity} ({i.unit}): {i.location_note}")
    lines += ["", "## MANUAL VALVES (no sensor; position known only by a person)",
              ", ".join(o["manual_valves"]), "",
              "## BLIND ASSETS (no streamed signal of their own; indirect evidence only)",
              "Format: asset; streamed points nearby; field dials nearby."]
    for b in o["blind_assets"]:
        lines.append(f"- {b['asset']}; streamed nearby: {', '.join(b['nearby_streamed']) or 'none'}; "
                     f"field nearby: {', '.join(b['nearby_field']) or 'none'}")
    return "\n".join(lines).rstrip() + "\n"


def _scale_text(i: Instrument) -> str:
    if i.display_scales and len(i.display_scales) > 1:
        psi = [s for s in i.display_scales if s.unit == "psi"]
        pick = psi[0] if psi else i.display_scales[0]
        others = ", ".join(f"{s.color or 'plain'} {s.unit} {s.min:g}-{s.max:g}"
                           for s in i.display_scales if s is not pick)
        return (f"Read the {pick.color or 'plain'} {pick.unit} scale ({pick.min:g}-{pick.max:g}). "
                f"Also printed: {others}; do not read it.")
    if i.display_scales:
        s = i.display_scales[0]
        return f"Read the {s.unit} scale ({s.min:g}-{s.max:g})."
    return f"Reading in {i.unit}, range {i.range[0]:g}-{i.range[1]:g}."


def human_tasks_block(pack: PlantPack) -> str:
    o = observability(pack)
    by_tag = {i.tag: i for i in pack.instruments}
    lines = [_header(pack), "",
             "Things only a person can do at the plant. SOP numbers are not mapped to valve tags yet.",
             "Lever valves: 0 degrees = lever parallel to the pipe = OPEN; 45 degrees = half travel (50%); 90 degrees = perpendicular to the pipe = CLOSED (100% of travel). Travel is staged: from 0 to about 45, hold a few seconds, then 90. A one-move jump from 0 to 90 is blocked by code.",
             "",
             f"## MANUAL VALVES ({len(o['manual_valves'])}): tag, location, what the position means"]
    for vid in o["manual_valves"]:
        a: Asset = pack.asset(vid)
        if a.kind == "valve" and a.spec.get("type") == "needle":
            means = "needle valve, throttled (not fully open or closed); sets recovery ratio and reject back-pressure"
        else:
            means = "lever: 0 deg = OPEN, 90 deg = CLOSED"
        normal = a.normal_state.get("position") if a.normal_state else "not stated"
        lines.append(f"- {vid} {_clean(a.name)} ({a.section}). {means}. "
                     f"Normal: {normal}.")
    lines += ["", "## DIAL AND ROTAMETER READINGS BY PHOTO (no API)"]
    for t in o["field_only"]:
        i = by_tag[t]
        nominal = f" Expected nominal {i.limits.nominal:g} {i.unit}." if i.limits and i.limits.nominal is not None else ""
        where = re.sub(r"\s*Dual scale dial:[^.]*\.", "", i.location_note or "").strip()
        lines.append(f"- {t}. Where to stand: {where} {_scale_text(i)}{nominal}")
    lines += ["", "## ROUTES: manual valve states each route needs (set by a person)"]
    for r in pack.routes:
        req = ", ".join(f"{v} {s}" for v, s in r.requires.items())
        lines.append(f"- {r.id} ({_clean(r.name)}): {req}.")
    lines += ["", "## SAMPLES", "No sampling points are defined in the plant pack. Do not assume any sample is taken."]
    return "\n".join(lines).rstrip() + "\n"


def _grid(pack: PlantPack) -> list[str]:
    """ASCII sketch at 1 character per metre. Top row is the largest z."""
    floor = pack.layout.floor
    max_x = max(x for x, _ in floor)
    max_z = max(z for _, z in floor)
    cols = int(math.ceil(max(p.x for p in pack.layout.placements.values()))) + 2
    rows = []
    cells = {}
    for aid, p in pack.layout.placements.items():
        cells[(int(round(p.x)), int(round(p.z)))] = KIND_LETTER.get(pack.asset(aid).kind, "?")
    for z in range(int(max_z) - 1, -1, -1):
        row = []
        for x in range(cols):
            if (x, z) in cells:
                row.append(cells[(x, z)])
            elif _inside(floor, x + 0.5, z + 0.5):
                row.append(".")
            else:
                row.append(" ")
        rows.append(f"{z:>2} |" + "".join(row).rstrip())
    rows.append("   +" + "-" * cols)
    ticks = "".join(str(x // 10) if x % 10 == 0 else " " for x in range(cols))
    rows.append("    " + ticks)
    rows.append(f"    x = 0 .. {int(max_x)} m (1 char = 1 m); z = 0 at bottom, larger z up. "
                f"Dots are floor; letters are placed assets.")
    return rows


def _inside(poly, x: float, y: float) -> bool:
    """Ray-casting point-in-polygon for the floor outline."""
    inside = False
    n = len(poly)
    for k in range(n):
        x1, y1 = poly[k]
        x2, y2 = poly[(k + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _legs(floor) -> tuple[str, str]:
    """Leg sizes derived from the floor outline (L-shape: long leg along x, short leg along z)."""
    max_x = max(x for x, _ in floor)
    max_z = max(z for _, z in floor)
    leg1_depth = max(z for x, z in floor if x == max_x)
    leg2_width = max(x for x, z in floor if z == max_z)
    leg1 = f"Leg 1 (L1): {max_x:g} x {leg1_depth:g} m, x 0 to {max_x:g}, z 0 to {leg1_depth:g}."
    leg2 = (f"Leg 2 (L2): {leg2_width:g} x {max_z - leg1_depth:g} m, x 0 to {leg2_width:g}, "
            f"z {leg1_depth:g} to {max_z:g}.")
    return leg1, leg2


def floor_plan_block(pack: PlantPack) -> str:
    lay = pack.layout
    if lay is None:
        raise ValueError("pack has no layout.yaml")
    leg1, leg2 = _legs(lay.floor)
    lines = [_header(pack), "",
             "APPROXIMATE: estimated from the footage and site description, not surveyed.",
             "Units: metres. Origin at the outer corner of the L. x runs along leg 1, z runs up leg 2.",
             "", leg1, leg2, "Outline: " + " ".join(f"({x:g},{z:g})" for x, z in lay.floor), "",
             "## Zones"]
    lines += [f"- {k}: {v}" for k, v in lay.zones.items()]
    lines += ["", "## Asset positions (x, z in m)"]
    for aid, p in lay.placements.items():
        a = pack.asset(aid)
        extra = f" {p.row}" if p.row else ""
        lines.append(f"- {aid} {a.kind}: x {p.x:g}, z {p.z:g}{extra}")
    lines += ["", "## Sketch"]
    lines += _grid(pack)
    lines += ["", "Letters: " + ", ".join(f"{v} {k}" for k, v in KIND_LETTER.items()) + ".", ""]
    lines += [f"- {n}" for n in lay.notes]
    return "\n".join(lines).rstrip() + "\n"


def glossary_block(pack: PlantPack) -> str:
    prefixes = {_prefix(i.tag) for i in pack.instruments}
    prefixes |= {_prefix(a.id) for a in pack.assets}
    prefixes |= {"E"}
    missing = prefixes - set(PREFIX_MEANING)
    if missing:
        raise KeyError(f"no glossary meaning for prefixes: {sorted(missing)}")
    lines = [_header(pack), "", "Tag and id prefixes used in this plant (prefix: meaning):"]
    for p in sorted(prefixes):
        lines.append(f"- {p}: {PREFIX_MEANING[p]}")
    lines.append("Tag form: PREFIX-NNN, e.g. PI-201.")
    return "\n".join(lines).rstrip() + "\n"


def build_memory(pack: PlantPack) -> list[MemoryBlock]:
    """The five plant_memory blocks for a pack. Raises if a block is over BLOCK_LIMIT."""
    blocks = [
        MemoryBlock("topology", "Plant topology: sections, assets, routes and pipes", topology_block(pack)),
        MemoryBlock("observability", "Observability: streamed points, field-only points, blind assets",
                    observability_block(pack)),
        MemoryBlock("human_tasks", "Human tasks at the plant: manual valves, dial readings, samples",
                    human_tasks_block(pack)),
        MemoryBlock("floor_plan", "Floor plan (approximate, metres)", floor_plan_block(pack)),
        MemoryBlock("glossary", "Tag glossary", glossary_block(pack)),
    ]
    for b in blocks:
        if len(b.body_md) > BLOCK_LIMIT:
            raise ValueError(f"memory block {b.kind} is {len(b.body_md)} chars, over {BLOCK_LIMIT}")
    return blocks

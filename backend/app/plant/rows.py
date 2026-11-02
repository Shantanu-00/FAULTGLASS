"""Flatten a validated pack into database rows (one list per table) for a release import."""
from __future__ import annotations

from typing import Any

from .models import Edge, PlantPack


def to_rows(pack: PlantPack, release_id: str, content_hash: str) -> dict[str, list[dict[str, Any]]]:
    m = pack.manifest
    rows: dict[str, list[dict[str, Any]]] = {
        "plant_releases": [{
            "id": release_id, "plant_id": m.id, "version": m.version, "content_hash": content_hash,
            "data_origin": m.data_origin, "facility_id": m.facility_id,
            "manifest": m.model_dump(mode="json"),
            "layout": pack.layout.model_dump(mode="json") if pack.layout else None,
        }],
        "plant_assets": [], "plant_ports": [], "plant_edges": [], "plant_routes": [],
        "data_sources": [], "instruments": [],
    }
    for a in pack.assets:
        rows["plant_assets"].append({
            "release_id": release_id, "asset_id": a.id, "name": a.name, "kind": a.kind,
            "section": a.section, "plan_item": a.plan_item, "basis": a.basis, "role": a.role,
            "control": a.control,
            "parent_asset_id": a.parent, "scene_node": a.scene_node,
            "normal_state": a.normal_state, "spec": a.spec,
        })
        for port, direction in a.ports.items():
            rows["plant_ports"].append({
                "release_id": release_id, "asset_id": a.id, "port_id": port, "direction": direction,
            })
    for e in pack.edges:
        (fa, fp), (ta, tp) = Edge.split(e.from_), Edge.split(e.to)
        rows["plant_edges"].append({
            "release_id": release_id, "edge_id": e.id, "from_asset_id": fa, "from_port_id": fp,
            "to_asset_id": ta, "to_port_id": tp, "medium": e.medium, "basis": e.basis,
        })
    for r in pack.routes:
        rows["plant_routes"].append({
            "release_id": release_id, "route_id": r.id, "name": r.name, "kind": r.kind,
            "from_asset_id": r.from_, "to_asset_id": r.to, "edge_ids": r.edges, "requires": r.requires,
        })
    for s in pack.sources:
        rows["data_sources"].append({
            "release_id": release_id, "source_id": s.id, "name": s.name, "protocol": s.protocol,
            "edge_node_id": s.edge_node, "poll_interval_s": s.poll_interval_s,
            "endpoint": s.endpoint, "credential_ref": s.credential_ref, "note": s.note,
        })
    for i in pack.instruments:
        a = i.attach
        kind, refs = (
            ("asset", [a.asset]) if a.asset else ("port", [a.port]) if a.port
            else ("edge", [a.edge]) if a.edge else ("span", list(a.span))
        )
        rows["instruments"].append({
            "release_id": release_id, "tag": i.tag, "name": i.name, "type": i.type,
            "quantity": i.quantity, "unit": i.unit, "range_min": i.range[0], "range_max": i.range[1],
            "attach_kind": kind, "attach_refs": refs, "observe": i.observe, "basis": i.basis,
            "display_scales": [d.model_dump(exclude_none=True) for d in i.display_scales] if i.display_scales else None,
            "source_id": i.source,
            "address": i.address, "scaling": i.scaling.model_dump() if i.scaling else None,
            "freshness_s": i.freshness_s,
            "limits": i.limits.model_dump(exclude_none=True) if i.limits else None,
            "setpoint": i.setpoint.model_dump() if i.setpoint else None,
            "state_labels": i.state_labels, "location_note": i.location_note, "note": i.note,
        })
    return rows

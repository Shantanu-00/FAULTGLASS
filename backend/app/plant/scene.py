"""Plant model for the 3D scene: layout, equipment, pipes and instruments, with no hidden state.

The scene renders observable structure only. Readings and valve positions arrive later as
state updates; nothing here tells the browser what a gauge reads."""
from __future__ import annotations

from typing import Any

from .briefing import observability
from .models import Edge, PlantPack


def scene_model(pack: PlantPack) -> dict[str, Any]:
    if pack.layout is None:
        raise ValueError(f"pack {pack.manifest.id} has no layout.yaml")
    o = observability(pack)
    blind = {b["asset"] for b in o["blind_assets"]}
    return {
        "plant": {
            "id": pack.manifest.id,
            "name": pack.manifest.name,
            "version": pack.manifest.version,
            "sections": pack.manifest.sections,
            "telemetry_mode": pack.manifest.conventions.get("telemetry_mode"),
        },
        "layout": pack.layout.model_dump(mode="json"),
        "assets": [
            {
                "id": a.id, "name": a.name, "kind": a.kind, "section": a.section,
                "role": a.role, "control": a.control, "basis": a.basis,
                "parent": a.parent, "ports": a.ports,
                "normal_state": a.normal_state,
                "blind": a.id in blind,
                "spec": {k: v for k, v in a.spec.items() if k in _SPEC_FOR_SCENE},
            }
            for a in pack.assets
        ],
        "edges": [
            {
                "id": e.id, "medium": e.medium, "basis": e.basis,
                "from": dict(zip(("asset", "port"), Edge.split(e.from_))),
                "to": dict(zip(("asset", "port"), Edge.split(e.to))),
            }
            for e in pack.edges
        ],
        "instruments": [
            {
                "tag": i.tag, "name": i.name, "type": i.type, "quantity": i.quantity, "unit": i.unit,
                "range": list(i.range), "observe": i.observe, "basis": i.basis,
                "attach": i.attach.model_dump(exclude_none=True),
                "display_scales": [d.model_dump(exclude_none=True) for d in i.display_scales or []],
                "state_labels": i.state_labels,
                "location_note": i.location_note,
            }
            for i in pack.instruments
        ],
        "routes": [
            {"id": r.id, "name": r.name, "kind": r.kind, "edges": r.edges, "requires": r.requires}
            for r in pack.routes
        ],
    }


# Spec keys the scene uses for geometry or labels; everything else stays server-side.
_SPEC_FOR_SCENE = {"line", "stage", "type", "handle", "lever_angle_deg", "function", "material", "mounting"}

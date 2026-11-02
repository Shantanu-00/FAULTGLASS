"""Deterministic tools Wonder may call. Code executes, validates, and bounds
every one; the model only chooses which to call (docs/DEMO.md, "Who does what").

Read tools return stored evidence only. A field_photo instrument (the analog
gauges with no API) can never be read through a telemetry tool: the tool
returns `requires_field_task` with the location note, which is what makes the
field dispatch consequential. Unknown tags/assets/SOPs return an error object
the model can recover from, never an exception that kills the loop.
"""
from __future__ import annotations

import datetime as dt
import json
from typing import Any

from ..plant.memory import build_memory
from ..plant.models import PlantPack
from ..repositories.investigation import InvestigationRepository
from ..repositories.runs import RunRepository
from ..repositories.telemetry import TelemetryRepository

MAX_WINDOW_POINTS = 120


def _fn(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    return {
        "type": "function",
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required or [],
            "additionalProperties": False,
        },
    }


TOOL_DEFS: list[dict[str, Any]] = [
    _fn("get_latest_telemetry", "Latest stored value for streamed telemetry tags. Optionally pass specific tags.",
        {"tags": {"type": "array", "items": {"type": "string"}}}),
    _fn("get_telemetry_window", "Recent stored readings for one streamed tag (oldest first, capped).",
        {"tag": {"type": "string"}, "seconds": {"type": "integer", "minimum": 10, "maximum": 3600}}, ["tag"]),
    _fn("get_signal_flag", "The Spark flag that opened this incident, with its computed evidence.", {}),
    _fn("recall_plant_memory", "Retrieve a plant-memory block: topology, observability, human_tasks, floor_plan, or glossary. This is the plant layout/topology source.",
        {"kind": {"type": "string", "enum": ["topology", "observability", "human_tasks", "floor_plan", "glossary"]}}, ["kind"]),
    _fn("recall_sop", "Retrieve a standard operating procedure by sop_id, or search title/triggers with query.",
        {"sop_id": {"type": "string"}, "query": {"type": "string"}}),
    _fn("recall_incident", "Retrieve a past (synthetic, labelled) incident by incident_id, or search title/root cause with query. Past incidents inform; they do not prove the current cause.",
        {"incident_id": {"type": "string"}, "query": {"type": "string"}}),
    _fn("get_asset_neighbours", "Upstream/downstream neighbours of an asset from the pipe graph, with their streamed and field-only instruments.",
        {"asset_id": {"type": "string"}}, ["asset_id"]),
    _fn("record_hypothesis", "Create or update a hypothesis (H1, H2, ...) with its status and the evidence for/against it. Call this whenever a hypothesis is formed, weakened, rejected, or supported.",
        {"label": {"type": "string"}, "statement": {"type": "string"},
         "status": {"type": "string", "enum": ["open", "rejected", "supported", "confirmed"]},
         "evidence_for": {"type": "array", "items": {"type": "string"}},
         "evidence_against": {"type": "array", "items": {"type": "string"}}},
        ["label", "statement", "status"]),
    _fn("update_focus", "Record the current focus for the commander UI: the goal, the blocker, the next step, and the asset ids in focus. Call this whenever the plan changes.",
        {"goal": {"type": "string"}, "blocker": {"type": "string"}, "next_step": {"type": "string"},
         "focus_assets": {"type": "array", "items": {"type": "string"}}},
        ["goal", "next_step"]),
    _fn("request_field_task", "Dispatch a person to collect evidence with no API (e.g. photograph dial gauges). Ends this turn of investigation until the result returns. asset_ids and tags must exist in the plant; tags must be field-read instruments.",
        {"kind": {"type": "string", "enum": ["gauge_photo", "valve_action", "observation"]},
         "asset_ids": {"type": "array", "items": {"type": "string"}},
         "tags": {"type": "array", "items": {"type": "string"}},
         "instruction": {"type": "string"}},
        ["kind", "instruction"]),
    _fn("propose_action", "Propose the only plant-changing action currently available: a V-113 backwash. This records a proposal for commander approval and ends the turn. It does not dispatch or move anything.",
        {"asset_id": {"type": "string", "enum": ["V-113"]},
         "action": {"type": "string", "enum": ["backwash"]},
         "rationale": {"type": "string"},
         "sop_id": {"type": "string"}},
        ["asset_id", "action", "rationale"]),
]


class ToolExecutor:
    def __init__(
        self,
        pack: PlantPack,
        telemetry: TelemetryRepository,
        investigation: InvestigationRepository,
        runs: RunRepository,
        *,
        incident_id: str,
        plant_id: str,
    ):
        self._pack = pack
        self._telemetry = telemetry
        self._inv = investigation
        self._runs = runs
        self._incident_id = incident_id
        self._plant_id = plant_id
        self._by_tag = {i.tag: i for i in pack.instruments}
        self.focus: dict[str, Any] = {}
        self.field_task_created: dict[str, Any] | None = None
        self.action_proposed: dict[str, Any] | None = None

    async def execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        handler = getattr(self, f"_tool_{name}", None)
        if handler is None:
            return {"error": f"unknown tool: {name}"}
        try:
            return await handler(arguments or {})
        except Exception as exc:  # a tool failure must not kill the loop
            return {"error": f"{name} failed: {exc.__class__.__name__}"}

    # ---- telemetry -------------------------------------------------------
    def _field_only(self, tag: str) -> dict[str, Any] | None:
        inst = self._by_tag.get(tag)
        if inst is None:
            return {"error": f"unknown tag: {tag}"}
        if inst.observe == "field_photo":
            return {
                "error": "requires_field_task",
                "tag": tag,
                "reason": "This instrument has no API; a person must read it on site.",
                "location_note": inst.location_note,
                "asset": inst.attach.asset or inst.attach.port,
            }
        return None

    async def _tool_get_latest_telemetry(self, args: dict) -> dict:
        wanted = args.get("tags") or None
        rows = await self._telemetry.latest(self._plant_id)
        out = []
        for row in rows:
            tag = row["tag"]
            if wanted and tag not in wanted:
                continue
            blocked = self._field_only(tag)
            if blocked:
                continue  # field gauges never appear in telemetry_latest anyway
            inst = self._by_tag[tag]
            entry: dict[str, Any] = {"tag": tag, "value": row["value"], "unit": row["unit"],
                                     "observed_at": row["observed_at"].isoformat() if row["observed_at"] else None}
            if inst.state_labels and row["value"] is not None:
                entry["state"] = inst.state_labels.get(str(int(row["value"])))
            out.append(entry)
        missing = [t for t in (wanted or []) if t not in {r["tag"] for r in rows}]
        result: dict[str, Any] = {"readings": out}
        for tag in missing:
            blocked = self._field_only(tag)
            if blocked:
                result.setdefault("field_only", []).append(blocked)
            else:
                result.setdefault("unknown", []).append(tag)
        return result

    async def _tool_get_telemetry_window(self, args: dict) -> dict:
        tag = args["tag"]
        blocked = self._field_only(tag)
        if blocked:
            return blocked
        seconds = int(args.get("seconds") or 300)
        since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=seconds)
        rows = await self._telemetry.history(self._plant_id, tag, since, MAX_WINDOW_POINTS)
        values = [r["value"] for r in rows if r["value"] is not None]
        result: dict[str, Any] = {"tag": tag, "unit": self._by_tag[tag].unit, "points": len(values)}
        if values:
            result.update({"first": values[0], "last": values[-1], "min": min(values), "max": max(values),
                           "mean": round(sum(values) / len(values), 3)})
        return result

    # ---- incident / memory ------------------------------------------------
    async def _tool_get_signal_flag(self, args: dict) -> dict:
        flag = await self._inv.flag_for_incident(self._incident_id)
        if flag is None:
            return {"error": "no signal flag for this incident"}
        return {"flag_id": str(flag["id"]), "severity": flag["severity"], "tags": flag["tags"],
                "summary": flag["summary"], "evidence": flag["evidence"], "model": flag["model"],
                "raised_at": flag["raised_at"].isoformat() if flag["raised_at"] else None}

    async def _tool_recall_plant_memory(self, args: dict) -> dict:
        kind = args["kind"]
        blocks = {b["kind"]: b for b in await self._inv.memory_blocks(self._plant_id)}
        if kind not in blocks:  # fall back to generating from the pack
            blocks = {b.kind: {"kind": b.kind, "title": b.title, "body_md": b.body_md}
                      for b in build_memory(self._pack)}
        if kind not in blocks:
            return {"error": f"unknown memory kind: {kind}"}
        block = blocks[kind]
        return {"kind": kind, "title": block["title"], "body_md": block["body_md"], "source": "plant_memory"}

    async def _tool_recall_sop(self, args: dict) -> dict:
        sops = await self._inv.sops()
        if args.get("sop_id"):
            for sop in sops:
                if sop["sop_id"] == args["sop_id"]:
                    return {"sop_id": sop["sop_id"], "title": sop["title"], "applies_to": sop["applies_to"],
                            "triggers": sop["triggers"], "steps": sop["steps"], "body_md": sop["body_md"],
                            "source": sop["sop_id"]}
            return {"error": f"unknown SOP: {args['sop_id']}", "available": [s["sop_id"] for s in sops]}
        query = (args.get("query") or "").lower()
        hits = [s for s in sops if query in s["title"].lower() or any(query in t.lower() for t in s["triggers"])] \
            if query else sops
        return {"sops": [{"sop_id": s["sop_id"], "title": s["title"], "triggers": s["triggers"]} for s in hits]}

    async def _tool_recall_incident(self, args: dict) -> dict:
        past = await self._inv.past_incidents(self._plant_id, self._incident_id)
        if args.get("incident_id"):
            for inc in past:
                if inc["incident_id"] == args["incident_id"]:
                    return self._incident_view(inc)
            return {"error": f"unknown past incident: {args['incident_id']}",
                    "available": [i["incident_id"] for i in past]}
        query = (args.get("query") or "").lower()
        hits = [i for i in past if query in i["title"].lower() or query in (i["root_cause"] or "").lower()] \
            if query else past
        return {"past_incidents": [self._incident_view(i, brief=True) for i in hits],
                "note": "Synthetic past incidents (data_origin=synthetic): patterns to check, not proof."}

    @staticmethod
    def _incident_view(inc: dict, brief: bool = False) -> dict:
        view = {"incident_id": inc["incident_id"], "title": inc["title"], "root_cause": inc["root_cause"],
                "sops_used": inc["sops_used"], "data_origin": "synthetic"}
        if not brief:
            view.update({"symptoms": inc["symptoms"], "resolution": inc["resolution"], "lessons": inc["lessons"]})
        return view

    async def _tool_get_asset_neighbours(self, args: dict) -> dict:
        asset_id = args["asset_id"]
        try:
            asset = self._pack.asset(asset_id)
        except StopIteration:
            return {"error": f"unknown asset: {asset_id}",
                    "known_sample": [a.id for a in self._pack.assets[:20]]}
        upstream, downstream = [], []
        for edge in self._pack.edges:
            src, dst = edge.from_.split(".")[0], edge.to.split(".")[0]
            if dst == asset_id:
                upstream.append(src)
            if src == asset_id:
                downstream.append(dst)
        instruments = []
        for inst in self._pack.instruments:
            anchor = inst.attach.asset or (inst.attach.port or "").split(".")[0] or inst.attach.edge
            if anchor == asset_id or (inst.attach.edge and any(
                    inst.attach.edge == e.id for e in self._pack.edges
                    if asset_id in (e.from_.split(".")[0], e.to.split(".")[0]))):
                instruments.append({"tag": inst.tag, "observe": inst.observe, "quantity": inst.quantity,
                                    "location_note": inst.location_note})
        return {"asset": {"id": asset.id, "name": asset.name, "kind": asset.kind, "section": asset.section},
                "upstream": sorted(set(upstream)), "downstream": sorted(set(downstream)),
                "instruments": instruments}

    # ---- structured state ---------------------------------------------------
    async def _tool_record_hypothesis(self, args: dict) -> dict:
        status = args["status"]
        await self._inv.upsert_hypothesis(
            self._incident_id, args["label"], args["statement"], status,
            args.get("evidence_for") or [], args.get("evidence_against") or [],
        )
        return {"recorded": args["label"], "status": status}

    async def _tool_update_focus(self, args: dict) -> dict:
        self.focus = {"goal": args.get("goal", ""), "blocker": args.get("blocker", ""),
                      "next_step": args.get("next_step", ""), "focus_assets": args.get("focus_assets") or []}
        return {"focus_recorded": True}

    async def _tool_propose_action(self, args: dict) -> dict:
        if args.get("asset_id") != "V-113" or args.get("action") != "backwash":
            return {"error": "only the V-113 backwash action is currently supported"}
        rationale = (args.get("rationale") or "").strip()
        if not rationale:
            return {"error": "rationale is required"}
        hypotheses = await self._inv.hypotheses(self._incident_id)
        if not any(h["status"] in ("supported", "confirmed") for h in hypotheses):
            return {"error": "a supported hypothesis is required before proposing a plant-changing action"}
        proposal = await self._inv.create_proposal(
            self._incident_id, asset_id="V-113", action="backwash",
            rationale=rationale[:1000], sop_id=args.get("sop_id"))
        view = {"proposal_id": str(proposal["id"]), "asset_id": proposal["asset_id"],
                "action": proposal["action"], "status": proposal["status"], "sop_id": proposal["sop_id"]}
        self.action_proposed = view
        return {"action_proposed": view, "note": "Commander approval is required before a valve task is dispatched."}

    async def _tool_request_field_task(self, args: dict) -> dict:
        if args.get("kind") == "valve_action":
            return {"error": "valve movement requires commander approval; use propose_action"}
        asset_ids = args.get("asset_ids") or []
        tags = args.get("tags") or []
        known_assets = {a.id for a in self._pack.assets}
        bad_assets = [a for a in asset_ids if a not in known_assets]
        if bad_assets:
            return {"error": f"unknown assets: {bad_assets}"}
        bad_tags = []
        for tag in tags:
            inst = self._by_tag.get(tag)
            if inst is None or inst.observe != "field_photo":
                bad_tags.append(tag)
        if bad_tags:
            return {"error": "tags must be existing field-read instruments", "bad_tags": bad_tags}
        if not (args.get("instruction") or "").strip():
            return {"error": "instruction is required"}
        if await self._inv.pending_field_task(self._incident_id):
            return {"error": "a field task is already pending for this incident"}
        task = await self._inv.create_field_task(
            self._incident_id, kind=args["kind"], asset_ids=asset_ids, tags=tags,
            instruction=args["instruction"].strip()[:500],
        )
        view = {"task_id": str(task["id"]), "kind": task["kind"], "asset_ids": task["asset_ids"],
                "tags": task["tags"], "instruction": task["instruction"], "status": task["status"]}
        self.field_task_created = view
        return {"field_task_created": view, "note": "Investigation pauses until the field result returns."}

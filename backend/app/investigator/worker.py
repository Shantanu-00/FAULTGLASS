"""Wonder investigator: wakes on a Spark-opened incident and works it.

Initialisation is staged, on purpose (this is how Active Memory is made
visible rather than prompt-stuffed):

  1. system instructions (role, honesty rules, hypothesis discipline)
  2. one user turn: the incident brief only (Spark flag + computed evidence,
     the goal, and a one-line plant snapshot: asset/instrument counts, which
     tags stream and which have no API)
  3. after that the MODEL drives retrieval: recall_plant_memory (topology,
     floor plan), recall_sop, recall_incident (past cases), then telemetry
     tools, recording hypotheses and focus as it goes

Every tool call, result, hypothesis change, recall, and focus update is
persisted to incident_trace / incident_hypotheses / the checkpoint, so the
commander UI renders what actually happened and a restart or a long field
pause loses nothing. The worker never resolves an incident and never reads
simulator truth: field gauges are only available through a field task.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Protocol

from ..plant.models import PlantPack
from ..repositories.investigation import InvestigationRepository
from ..repositories.runs import RunRepository
from ..repositories.telemetry import TelemetryRepository
from .tools import TOOL_DEFS, ToolExecutor
from .wonder import WonderReply

log = logging.getLogger("investigator")

MAX_STEPS = 12

SYSTEM_PROMPT = """You are Muse Wonder, the lead investigator for LastMeter at a mineral-water plant.
A telemetry watcher (Muse Spark Open) has already flagged drift and opened this incident. Your job is to find the likely cause by gathering evidence, not to guess.

How to work:
- Start by recalling context with your tools: plant memory (topology and observability), the relevant SOP, and any past incident that matches. Cite what you recall by its id/kind when you use it.
- Form several competing hypotheses early and record each with record_hypothesis. As telemetry arrives, update them: evidence_for, evidence_against, rejected or supported. Never silently drop one.
- Keep the focus current with update_focus (goal, blocker, next step, assets in focus) whenever your plan changes.
- Work hypotheses in parallel where telemetry can settle several at once. Prefer cheap streamed checks before dispatching a person.
- If the evidence needed has no API (analog gauges, valve levers, anything marked field-only), dispatch exactly one bounded field task with request_field_task, saying precisely what to photograph or read and where. Then stop; do not invent the reading.
- When evidence is insufficient, ask for more data through a tool or a field task. Never answer that you cannot determine anything and stop while a check remains available.
- You may not resolve or close the incident, move a valve, or state a cause as proven when it is only likely. Say "likely" where that is what the evidence supports.
- Check in before any action that changes the plant: propose it in your conclusion and stop.

Telemetry is SIMULATED for this demonstration; gauge and valve evidence will arrive as field-task results."""


class WonderLike(Protocol):
    @property
    def model(self) -> str: ...

    async def create(self, input_items: list[dict[str, Any]], tools: list[dict[str, Any]], *,
                     reasoning_effort: str = "medium") -> WonderReply: ...


@dataclass(frozen=True)
class InvestigatorConfig:
    plant_id: str
    interval_s: float = 5.0
    max_steps: int = MAX_STEPS


class Investigator:
    def __init__(
        self,
        pack: PlantPack,
        telemetry: TelemetryRepository,
        investigation: InvestigationRepository,
        runs: RunRepository,
        wonder: WonderLike,
        config: InvestigatorConfig,
    ):
        self._pack = pack
        self._telemetry = telemetry
        self._inv = investigation
        self._runs = runs
        self._wonder = wonder
        self._config = config

    async def tick(self) -> list[str]:
        results = []
        for incident in await self._inv.open_live_incidents(self._config.plant_id):
            try:
                results.append(await self.investigate(incident["incident_id"]))
            except Exception:
                log.exception("investigation failed for %s", incident["incident_id"])
                results.append("error")
        return results

    async def investigate(self, incident_id: str) -> str:
        checkpoint = await self._inv.checkpoint(incident_id)
        status = checkpoint["status"] if checkpoint else "investigating"
        if status != "investigating":
            return f"skipped-{status}"
        continuation: list[dict[str, Any]] = list(checkpoint["continuation"]) if checkpoint else []
        steps = checkpoint["steps_used"] if checkpoint else 0
        focus: dict[str, Any] = dict(checkpoint["focus"]) if checkpoint else {}
        executor = ToolExecutor(
            self._pack, self._telemetry, self._inv, self._runs,
            incident_id=incident_id, plant_id=self._config.plant_id,
        )
        executor.focus = focus

        if not continuation:
            continuation = await self._initial_input(incident_id)
            await self._inv.pick_up_flag(incident_id)
            await self._inv.add_trace(incident_id, kind="note", actor="code",
                                      content="Investigation started by Muse Wonder.")

        # Resume on any field results that arrived while paused.
        for task in await self._inv.unconsumed_results(incident_id):
            readings = (task["result"] or {}).get("readings", {})
            note = (task["result"] or {}).get("note", "")
            detail = "; ".join(f"{tag} = {value}" for tag, value in readings.items()) or "no readings submitted"
            continuation.append({
                "role": "user",
                "content": (f"Field task completed ({task['kind']} on {', '.join(task['asset_ids']) or 'plant'}). "
                            f"Readings: {detail}. Operator note: {note or 'none'}. "
                            "Reassess your hypotheses with this evidence and continue."),
            })
            await self._inv.add_trace(incident_id, kind="human_result", actor="operator",
                                      content=f"Field result: {detail}", evidence=list(readings.keys()))
            await self._inv.mark_consumed(task["id"])

        while steps < self._config.max_steps:
            reply = await self._wonder.create(continuation, TOOL_DEFS)
            steps += 1
            continuation.extend(reply.output)  # reasoning items replayed intact, never edited
            calls = reply.function_calls
            if not calls:
                text = reply.text or "(no visible conclusion)"
                await self._inv.add_trace(incident_id, kind="note", actor="model", content=text[:2000])
                pending = await self._inv.pending_field_task(incident_id)
                final_status = "waiting_field" if pending else "concluded"
                await self._save(incident_id, final_status, steps, continuation, executor.focus)
                log.info("%s %s after %d steps", incident_id, final_status, steps)
                return final_status
            for call in calls:
                name = call.get("name", "")
                try:
                    args = json.loads(call.get("arguments") or "{}")
                except ValueError:
                    args = {}
                await self._inv.add_trace(incident_id, kind="tool_call", actor="model",
                                          content=f"{name}({json.dumps(args)[:300]})", tool_name=name,
                                          hypothesis_id=args.get("label"))
                result = await executor.execute(name, args)
                await self._trace_result(incident_id, name, args, result)
                continuation.append({
                    "type": "function_call_output",
                    "call_id": call.get("call_id", ""),
                    "output": json.dumps(result),
                })
            focus = executor.focus or focus
            if executor.field_task_created:
                task = executor.field_task_created
                await self._inv.add_trace(
                    incident_id, kind="human_task", actor="model",
                    content=f"Field task: {task['instruction']}", evidence=task["tags"] or task["asset_ids"])
                await self._save(incident_id, "waiting_field", steps, continuation, focus)
                log.info("%s waiting_field (%s)", incident_id, task["task_id"])
                return "waiting_field"
            await self._save(incident_id, "investigating", steps, continuation, focus)

        await self._inv.add_trace(incident_id, kind="note", actor="code",
                                  content=f"Step budget ({self._config.max_steps}) reached; escalating for human review.")
        await self._save(incident_id, "escalated", steps, continuation, executor.focus or focus)
        return "escalated"

    async def _trace_result(self, incident_id: str, name: str, args: dict, result: dict) -> None:
        kind = {"recall_plant_memory": "recall", "recall_sop": "recall", "recall_incident": "recall"}.get(name, "tool_result")
        if name == "record_hypothesis":
            kind = "hypothesis_rejected" if args.get("status") == "rejected" else "hypothesis"
        summary = json.dumps(result)[:500]
        await self._inv.add_trace(incident_id, kind=kind, actor="code", content=f"{name} -> {summary}",
                                  tool_name=name, hypothesis_id=args.get("label"))

    async def _save(self, incident_id: str, status: str, steps: int,
                    continuation: list, focus: dict) -> None:
        await self._inv.save_checkpoint(
            incident_id, status=status, steps_used=steps, continuation=continuation,
            focus=focus, model=self._wonder.model)

    async def _initial_input(self, incident_id: str) -> list[dict[str, Any]]:
        incident = await self._inv.incident(incident_id)
        flag = await self._inv.flag_for_incident(incident_id)
        streamed = [i.tag for i in self._pack.instruments if i.observe == "telemetry"]
        field_only = [i.tag for i in self._pack.instruments if i.observe == "field_photo"]
        brief = {
            "incident_id": incident_id,
            "title": incident["title"] if incident else "Signal flag",
            "severity": incident["severity"] if incident else "high",
            "goal": "Find the likely cause of the flagged production drift and decide the next check or proposed action.",
            "spark_flag": ({"summary": flag["summary"], "tags": flag["tags"],
                            "evidence": flag["evidence"], "raised_by": flag["model"]} if flag else None),
            "plant_snapshot": {
                "plant": self._pack.manifest.name,
                "assets": len(self._pack.assets),
                "instruments": len(self._pack.instruments),
                "streamed_tags": streamed,
                "field_only_tags": field_only,
            },
            "first_moves": "Recall plant memory (topology, observability), the matching SOP, and a past incident; then check streamed telemetry and record your opening hypotheses.",
        }
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "New incident opened by the telemetry watcher:\n" + json.dumps(brief, indent=2)},
        ]

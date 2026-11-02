from __future__ import annotations

import datetime as dt
import secrets
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse

from ..repositories.runs import ActiveRunExists
from ..repositories.telemetry import Reading
from .schemas import CompleteTaskIn, CreateRun, EventIn
from .sse import telemetry_events

router = APIRouter(prefix="/v1")


def require_simulation(request: Request) -> None:
    if not request.app.state.simulation_enabled:
        raise HTTPException(403, "simulation is disabled for this plant")


@router.get("/healthz")
async def healthz(request: Request):
    await request.app.state.telemetry.head_cursor(request.app.state.plant_id)
    return {"status": "ok"}


@router.get("/plant")
async def plant(request: Request):
    state = request.app.state
    return {
        "plant_id": state.plant_id,
        "name": state.plant_name,
        "simulation": state.simulation_enabled,
        "signals": [
            {
                "tag": s.tag,
                "name": s.name,
                "type": s.type,
                "quantity": s.quantity,
                "unit": s.unit,
                "range": list(s.range),
                "limits": s.limits.model_dump(exclude_none=True) if s.limits else {},
                "setpoint": s.setpoint.model_dump() if s.setpoint else None,
                "state_labels": s.state_labels,
                "freshness_s": s.freshness_s,
            }
            for s in state.signals.values()
        ],
    }


@router.get("/sim/runs/current")
async def current_run(request: Request):
    run = await request.app.state.runs.active(request.app.state.plant_id)
    return {"run": run.to_json() if run else None}


@router.post("/sim/runs", status_code=201)
async def create_run(request: Request, body: CreateRun):
    require_simulation(request)
    state = request.app.state
    try:
        run = await state.runs.create(state.plant_id, seed=secrets.randbits(31), clock_speed=body.clock_speed)
    except ActiveRunExists:
        raise HTTPException(409, "a run is already active")
    return run.to_json()


@router.post("/sim/runs/{run_id}/heartbeat", status_code=204)
async def heartbeat(request: Request, run_id: UUID):
    if not await request.app.state.runs.heartbeat(run_id):
        raise HTTPException(404, "run is not active")
    return Response(status_code=204)


@router.post("/sim/runs/{run_id}/stop", status_code=204)
async def stop_run(request: Request, run_id: UUID):
    if not await request.app.state.runs.stop(run_id, "requested"):
        raise HTTPException(404, "run is not active")
    return Response(status_code=204)


@router.post("/sim/runs/{run_id}/events", status_code=201)
async def add_event(request: Request, run_id: UUID, body: EventIn):
    require_simulation(request)
    runs = request.app.state.runs
    run = await runs.get(run_id)
    if run is None or run.status == "stopped":
        raise HTTPException(404, "run is not active")
    if run.status != "running":
        raise HTTPException(409, "the baseline is still being learned")
    if body.kind == "valve_action" and run.scenario is None:
        raise HTTPException(409, "no scenario is active")
    event = await runs.add_event(run_id, body.kind, body.payload)
    if event is None:
        raise HTTPException(404, "run is not active")
    return {"id": event.id, "kind": event.kind, "at": event.at.isoformat()}


@router.get("/telemetry/latest")
async def latest(request: Request):
    state = request.app.state
    rows = await state.telemetry.latest(state.plant_id)
    run = await state.runs.active(state.plant_id)
    return jsonable_encoder({"readings": rows, "run": run.to_json() if run else None})


@router.get("/telemetry/history")
async def history(
    request: Request,
    tag: str,
    seconds: int = Query(300, ge=10, le=3600),
    limit: int = Query(600, ge=1, le=3600),
):
    state = request.app.state
    if tag not in state.signals:
        raise HTTPException(404, "unknown tag")
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=seconds)
    rows = await state.telemetry.history(state.plant_id, tag, since, limit)
    return jsonable_encoder({"tag": tag, "points": rows})


@router.get("/telemetry/stream")
async def stream(request: Request, cursor: int | None = None):
    state = request.app.state
    last_event_id = request.headers.get("last-event-id")
    if cursor is None and last_event_id and last_event_id.isdigit():
        cursor = int(last_event_id)
    if cursor is None:
        cursor = await state.telemetry.head_cursor(state.plant_id)
    return StreamingResponse(
        telemetry_events(state.telemetry, state.plant_id, cursor),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/flags")
async def flags(request: Request, limit: int = Query(50, ge=1, le=200)):
    state = request.app.state
    return jsonable_encoder({"flags": await state.flags.recent(state.plant_id, limit)})


@router.get("/incidents")
async def incidents(request: Request):
    """Live incidents with their investigation status and current focus."""
    state = request.app.state
    return jsonable_encoder({"incidents": await state.investigation.live_incidents(state.plant_id)})


@router.get("/incidents/{incident_id}")
async def incident_detail(request: Request, incident_id: str):
    state = request.app.state
    inv = state.investigation
    incident = await inv.incident(incident_id)
    if incident is None:
        raise HTTPException(404, "unknown incident")
    checkpoint = await inv.checkpoint(incident_id)
    return jsonable_encoder({
        "incident": incident,
        "flag": await inv.flag_for_incident(incident_id),
        "hypotheses": await inv.hypotheses(incident_id),
        "field_tasks": await inv.field_tasks(incident_id),
        "trace": await inv.trace(incident_id),
        "investigation": (
            {"status": checkpoint["status"], "steps_used": checkpoint["steps_used"], "focus": checkpoint["focus"]}
            if checkpoint else {"status": "not_started", "steps_used": 0, "focus": {}}
        ),
    })


@router.post("/incidents/{incident_id}/tasks/{task_id}/complete")
async def complete_task(request: Request, incident_id: str, task_id: UUID, body: CompleteTaskIn):
    """Submit field evidence for a pending task and resume the investigation.

    Manual stub: readings are typed values for the task's tags. The photo/SAM
    pipeline will produce the same readings shape later; nothing else changes.
    """
    state = request.app.state
    inv = state.investigation
    tasks = [t for t in await inv.field_tasks(incident_id) if str(t["id"]) == str(task_id)]
    if not tasks:
        raise HTTPException(404, "unknown task for this incident")
    task = tasks[0]
    if task["status"] != "pending":
        raise HTTPException(409, "task is not pending")
    by_tag = {i.tag: i for i in state.pack.instruments}
    unknown = [t for t in body.readings if t not in task["tags"] or t not in by_tag]
    if unknown:
        raise HTTPException(422, f"readings must be for this task's field tags: {sorted(unknown)}")
    now = dt.datetime.now(dt.timezone.utc)
    run = await state.runs.active(state.plant_id)
    readings = [
        Reading(tag=tag, observed_at=now, value=value, raw_value=None,
                unit=by_tag[tag].unit, quality="good", source_id="field_task")
        for tag, value in body.readings.items()
    ]
    await state.telemetry.insert_field_readings(
        state.plant_id, readings, run_id=run.id if run else None)
    await inv.complete_field_task(task_id, {"readings": body.readings, "note": body.note, "source": "manual_entry"})
    checkpoint = await inv.checkpoint(incident_id)
    if checkpoint and checkpoint["status"] == "waiting_field":
        await inv.save_checkpoint(
            incident_id, status="investigating", steps_used=checkpoint["steps_used"],
            continuation=checkpoint["continuation"], focus=checkpoint["focus"], model=checkpoint["model"])
    return {"completed": True, "readings_stored": len(readings)}

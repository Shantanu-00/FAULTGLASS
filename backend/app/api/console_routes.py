from __future__ import annotations

import asyncio
import datetime as dt
import secrets
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse

from ..repositories.runs import ActiveRunExists
from ..repositories.telemetry import Reading
from .schemas import CompleteTaskIn, CreateRun, EventIn, PhotoTaskIn, VideoTaskIn, VoiceTaskIn
from .sse import telemetry_events

router = APIRouter(prefix="/v1")


def require_simulation(request: Request) -> None:
    if not request.app.state.simulation_enabled:
        raise HTTPException(403, "simulation is disabled for this plant")


def _decode_base64(value: str, label: str) -> bytes:
    import base64

    try:
        return base64.b64decode(value, validate=True)
    except ValueError:
        raise HTTPException(422, f"{label} is not valid base64")


def _save_upload(data: bytes, filename: str) -> tuple[str, str]:
    import hashlib
    import os
    from pathlib import Path

    digest = hashlib.sha256(data).hexdigest()
    upload_dir = Path(os.environ.get("UPLOAD_DIR", "uploads"))
    upload_dir.mkdir(parents=True, exist_ok=True)
    path = upload_dir / filename
    path.write_bytes(data)
    return digest, str(path)


async def _find_task(state, incident_id: str, task_id: UUID):
    tasks = [t for t in await state.investigation.field_tasks(incident_id) if str(t["id"]) == str(task_id)]
    if not tasks:
        raise HTTPException(404, "unknown task for this incident")
    return tasks[0]


async def _process_voice(state, incident_id: str, task: dict, audio_bytes: bytes,
                         photo_readings: dict[str, float], language_bias: list[str]) -> dict:
    """Transcribe, structure, compare, persist, and trace one voice note."""
    from ..evidence.voice import MetaVoiceClient, WonderObservationAnalyzer
    from ..investigator.__main__ import meta_key
    from ..investigator.wonder import WonderClient

    digest, path = _save_upload(audio_bytes, f"{task['id']}-voice.wav")
    voice = MetaVoiceClient(meta_key())
    wonder = WonderClient(meta_key())
    try:
        transcript = await voice.transcribe_wav(
            audio_bytes, language_bias=language_bias,
            keywords=[*task["tags"], "cartridge", "pressure", "psi", "V-113", "backwash"])
        analyzed = await WonderObservationAnalyzer(wonder).analyze(
            transcript.text, photo_readings, list(task["tags"]))
    finally:
        await voice.aclose()
        await wonder.aclose()
    payload = {
        "transcript": transcript.text,
        "session_id": transcript.session_id,
        "audio_duration_ms": transcript.audio_duration_ms,
        "structured": analyzed["structured"],
        "comparison": analyzed["comparison"],
        "model": transcript.model,
    }
    record = await state.investigation.create_voice_observation(
        incident_id, task_id=task["id"], transcript=transcript.text,
        language_bias=language_bias, structured=analyzed["structured"],
        comparison=analyzed["comparison"], audio_sha256=digest, audio_path=path,
        model=transcript.model)
    payload["id"] = str(record["id"])
    await state.investigation.add_trace(
        incident_id, kind="observation", actor="operator",
        content=f"Voice ({analyzed['comparison']['status']}): {transcript.text[:400]}",
        evidence=list(task["tags"]))
    return payload


async def run_isolated(make_coroutine):
    """Run model analysis on its own thread and event loop so decoding and fitting never stall the API."""
    return await asyncio.to_thread(lambda: asyncio.run(make_coroutine()))


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


@router.post("/sim/reset", status_code=201)
async def reset_run(request: Request, body: CreateRun):
    """Stop the active run, close its incidents and open work, and start a fresh run."""
    require_simulation(request)
    state = request.app.state
    active = await state.runs.active(state.plant_id)
    if active is not None:
        await state.runs.stop(active.id, "replaced")
    await state.investigation.abandon_open_work(state.plant_id)
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
        "action_proposals": await inv.proposals(incident_id),
        "voice_observations": await inv.voice_observations(incident_id),
        "trace": await inv.trace(incident_id),
        "investigation": (
            {"status": checkpoint["status"], "steps_used": checkpoint["steps_used"], "focus": checkpoint["focus"],
             "model": checkpoint["model"]}
            if checkpoint else {"status": "not_started", "steps_used": 0, "focus": {}, "model": None}
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
    differential = await _record_differential(state, incident_id, body.readings)
    await inv.complete_field_task(task_id, {
        "readings": body.readings, "differential": differential, "note": body.note, "source": "manual_entry"})
    await _resume(state, incident_id)
    return {"completed": True, "readings_stored": len(readings)}


async def _resume(state, incident_id: str) -> None:
    inv = state.investigation
    checkpoint = await inv.checkpoint(incident_id)
    if checkpoint and checkpoint["status"] == "waiting_field":
        await inv.save_checkpoint(
            incident_id, status="investigating", steps_used=checkpoint["steps_used"],
            continuation=checkpoint["continuation"], focus=checkpoint["focus"], model=checkpoint["model"])


@router.post("/incidents/{incident_id}/tasks/{task_id}/photo")
async def complete_task_photo(request: Request, incident_id: str, task_id: UUID, body: PhotoTaskIn):
    """Gauge photos (one per gauge) -> SAM finds the dial -> Wonder reads it -> field telemetry.

    Only cross-checked (agree) or single-source readings are stored. A gauge that cannot be read
    is reported and the task stays pending; accepted gauges are kept, so the worker re-shoots only
    the missing one. When every gauge of the task is read, code computes the bank differential.
    """
    state = request.app.state
    inv = state.investigation
    task = await _find_task(state, incident_id, task_id)
    if task["status"] != "pending":
        raise HTTPException(409, "task is not pending")
    if task["kind"] != "gauge_photo":
        raise HTTPException(422, "photo submission is only for gauge_photo tasks")
    unknown = sorted(t for t in body.photos if t not in task["tags"])
    if unknown:
        raise HTTPException(422, f"photos must be for this task's gauges {task['tags']}: {unknown}")
    images = {tag: _decode_base64(data, f"photos.{tag}") for tag, data in body.photos.items()}
    saved = {tag: _save_upload(data, f"{task_id}-{tag}.jpg") for tag, data in images.items()}

    from ..evidence.gauge import GaugePipeline, WonderGaugeReader
    from ..evidence.sam import SamClient, SamError
    from ..investigator.__main__ import meta_key
    from ..investigator.wonder import WonderClient

    by_tag = {i.tag: i for i in state.pack.instruments}

    async def read_gauges():
        sam = SamClient(meta_key())
        wonder = WonderClient(meta_key())
        try:
            pipeline = GaugePipeline(sam=sam, reader=WonderGaugeReader(wonder))
            return await asyncio.gather(*(pipeline.read_photo(data, by_tag[tag]) for tag, data in images.items()))
        finally:
            await sam.aclose()
            await wonder.aclose()

    try:
        results = await run_isolated(read_gauges)
    except SamError as exc:
        raise HTTPException(502, f"segmentation failed: {exc}")

    progress = task["result"] or {}
    gauges = {**(progress.get("gauges_by_tag") or {}), **{r.tag: r.to_json() for r in results}}
    accepted_now = {r.tag: r.value for r in results if r.value is not None and r.status in ("agree", "single_source")}
    accepted = {**(progress.get("accepted") or {}), **accepted_now}
    if accepted_now:
        now = dt.datetime.now(dt.timezone.utc)
        run = await state.runs.active(state.plant_id)
        await state.telemetry.insert_field_readings(
            state.plant_id,
            [Reading(tag=tag, observed_at=now, value=value, raw_value=None, unit=by_tag[tag].unit,
                     quality="good", source_id="field_photo") for tag, value in accepted_now.items()],
            run_id=run.id if run else None)
    missing = [t for t in task["tags"] if t not in accepted]
    if missing:
        await inv.save_task_progress(task_id, {"accepted": accepted, "gauges_by_tag": gauges})
        return {"completed": False, "readings": list(gauges.values()), "accepted": accepted, "missing": missing,
                "reason": "Still needed: " + ", ".join(missing)
                          + ". Re-shoot that gauge closer, square-on, with the needle visible."}
    voice_payload = None
    if body.audio_base64:
        try:
            voice_payload = await _process_voice(
                state, incident_id, task, _decode_base64(body.audio_base64, "audio_base64"),
                accepted, ["Marathi", "English"])
        except Exception as exc:  # voice must not erase valid photo evidence
            voice_payload = {"error": f"voice processing failed: {exc.__class__.__name__}"}
    differential = await _record_differential(state, incident_id, accepted)
    await inv.complete_field_task(task_id, {
        "readings": accepted, "differential": differential, "note": body.note, "source": "gauge_photo",
        "photos": {tag: {"sha256": digest, "path": path} for tag, (digest, path) in saved.items()},
        "gauges": list(gauges.values()), "voice": voice_payload,
    })
    await _resume(state, incident_id)
    return {"completed": True, "readings_stored": len(accepted_now), "readings": list(gauges.values()),
            "accepted": accepted, "differential": differential, "voice": voice_payload}


async def _record_differential(state, incident_id: str, readings: dict[str, float]) -> dict | None:
    """Compute the bank differential in code and put it in the audit trail."""
    from ..evidence.differential import compute_differential

    differential = compute_differential(readings, state.pack.instruments)
    if differential is None:
        return None
    await state.investigation.add_trace(
        incident_id, kind="observation", actor="code", content="Cartridge bank differential: " + differential.summary(),
        evidence=[differential.to_json()["inlet_tag"], differential.to_json()["outlet_tag"]])
    return differential.to_json()


@router.post("/incidents/{incident_id}/tasks/{task_id}/voice")
async def submit_task_voice(request: Request, incident_id: str, task_id: UUID, body: VoiceTaskIn):
    """Transcribe a WAV note and compare any spoken values with photo evidence."""
    state = request.app.state
    task = await _find_task(state, incident_id, task_id)
    result = task["result"] or {}
    photo_readings = {str(k): float(v) for k, v in (result.get("readings") or {}).items()}
    try:
        payload = await _process_voice(
            state, incident_id, task, _decode_base64(body.audio_base64, "audio_base64"),
            photo_readings, body.language_bias)
    except Exception as exc:
        raise HTTPException(502, f"voice pipeline failed: {exc.__class__.__name__}: {exc}")
    return {"recorded": True, "voice": payload}


@router.post("/incidents/{incident_id}/proposals/{proposal_id}/approve")
async def approve_proposal(request: Request, incident_id: str, proposal_id: UUID):
    """Commander approval: create the staged V-113 field task and pause Wonder."""
    state = request.app.state
    inv = state.investigation
    proposal = await inv.proposal(proposal_id)
    if proposal is None or proposal["incident_id"] != incident_id:
        raise HTTPException(404, "unknown proposal for this incident")
    if proposal["status"] != "pending":
        raise HTTPException(409, "proposal is not pending")
    task = await inv.create_field_task(
        incident_id, kind="valve_action", asset_ids=[proposal["asset_id"]], tags=[],
        instruction=(
            "Record one continuous clip of V-113: show the lever parallel to the pipe for one second, "
            "move it to 45 degrees and hold for at least two seconds, then move it to 90 degrees "
            "perpendicular to the pipe. Keep the lever and a straight pipe run visible."))
    await inv.approve_proposal(proposal_id, task["id"])
    checkpoint = await inv.checkpoint(incident_id)
    if checkpoint:
        await inv.save_checkpoint(
            incident_id, status="waiting_field", steps_used=checkpoint["steps_used"],
            continuation=checkpoint["continuation"], focus=checkpoint["focus"], model=checkpoint["model"])
    await inv.add_trace(incident_id, kind="action", actor="operator",
                        content="Commander approved the V-113 backwash proposal.", evidence=["V-113"])
    return {"approved": True, "field_task_id": str(task["id"])}


@router.post("/incidents/{incident_id}/proposals/{proposal_id}/reject")
async def reject_proposal(request: Request, incident_id: str, proposal_id: UUID):
    state = request.app.state
    inv = state.investigation
    proposal = await inv.proposal(proposal_id)
    if proposal is None or proposal["incident_id"] != incident_id:
        raise HTTPException(404, "unknown proposal for this incident")
    if proposal["status"] != "pending":
        raise HTTPException(409, "proposal is not pending")
    await inv.set_proposal_status(proposal_id, "rejected", result={"rejected_by": "commander"})
    checkpoint = await inv.checkpoint(incident_id)
    if checkpoint:
        continuation = list(checkpoint["continuation"])
        continuation.append({"role": "user", "content": "The commander rejected the proposed valve action. Continue investigating or state what further evidence is needed; do not propose the same action without new evidence."})
        await inv.save_checkpoint(
            incident_id, status="investigating", steps_used=checkpoint["steps_used"],
            continuation=continuation, focus=checkpoint["focus"], model=checkpoint["model"])
    await inv.add_trace(incident_id, kind="action", actor="operator",
                        content="Commander rejected the V-113 backwash proposal.", evidence=["V-113"])
    return {"rejected": True}


@router.post("/incidents/{incident_id}/tasks/{task_id}/video")
async def complete_task_video(request: Request, incident_id: str, task_id: UUID, body: VideoTaskIn):
    """SAM lever clip -> staged policy -> simulator action only after a pass."""
    state = request.app.state
    inv = state.investigation
    task = await _find_task(state, incident_id, task_id)
    if task["status"] != "pending":
        raise HTTPException(409, "task is not pending")
    if task["kind"] != "valve_action":
        raise HTTPException(422, "video submission is only for valve_action tasks")
    video_bytes = _decode_base64(body.video_base64, "video_base64")
    suffix = ".mov" if body.mime_type == "video/quicktime" else ".mp4"
    digest, video_path = _save_upload(video_bytes, f"{task_id}{suffix}")

    from ..evidence.sam import SamClient
    from ..evidence.valve import analyze_valve_clip
    from ..investigator.__main__ import meta_key

    async def track_lever():
        sam = SamClient(meta_key())
        try:
            return await analyze_valve_clip(
                sam, video_bytes, f"{task_id}{suffix}", body.mime_type, fps=body.fps)
        finally:
            await sam.aclose()

    try:
        analysis = await run_isolated(track_lever)
    except Exception as exc:
        raise HTTPException(502, f"lever segmentation failed: {exc.__class__.__name__}: {exc}")
    policy = analysis["policy"]
    base_result = {"note": body.note, "source": "valve_video", "video_sha256": digest,
                   "video_path": video_path, "video_file_id": analysis["file_id"],
                   "duration_s": body.duration_s, "fps": body.fps,
                   "track": analysis["track"], "policy": policy}
    if policy["status"] != "passed":
        await inv.add_trace(incident_id, kind="observation", actor="code",
                            content=f"Valve clip {policy['status']}: {'; '.join(policy['reasons'])}",
                            evidence=list(task["asset_ids"]))
        return {"completed": False, **base_result,
                "reason": "The staged rule was not proven. Keep the task open and submit a clearer continuous clip."}

    run = await state.runs.active(state.plant_id)
    if run is None or run.status != "running" or not run.scenario:
        raise HTTPException(409, "no running scenario is available to receive the verified backwash")
    event_id = await state.runs.add_event(run.id, "valve_action", {"action": "backwash_completed"})
    if event_id is None:
        raise HTTPException(409, "simulator did not acknowledge the verified backwash")
    result = {**base_result, "simulator_event_id": str(event_id), "simulator_action": "backwash_completed"}
    await inv.complete_field_task(task_id, result)
    proposal = await inv.proposal_for_task(task_id)
    if proposal:
        await inv.set_proposal_status(proposal["id"], "executed", result={
            "field_task_id": str(task_id), "simulator_event_id": str(event_id), "policy": policy})
    await inv.add_trace(incident_id, kind="action", actor="code",
                        content="Staged V-113 sequence passed; simulator backwash action acknowledged. Awaiting verifier.",
                        evidence=["V-113"])
    await _resume(state, incident_id)
    return {"completed": True, **result}

from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.encoders import jsonable_encoder
import psycopg.errors

from ..repositories.edge_nodes import EdgeNode
from ..repositories.telemetry import Reading
from .schemas import IngestRequest

router = APIRouter(prefix="/v1")

MAX_FUTURE_SKEW = dt.timedelta(minutes=5)


async def authenticated_edge(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    x_edge_node: Annotated[str | None, Header()] = None,
) -> EdgeNode:
    scheme, _, key = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not key or not x_edge_node:
        raise HTTPException(401, "edge credentials required")
    node = await request.app.state.edge_nodes.authenticate(x_edge_node, key)
    if node is None:
        raise HTTPException(401, "edge credentials rejected")
    return node


EdgeAuth = Annotated[EdgeNode, Depends(authenticated_edge)]


@router.get("/edge/session")
async def edge_session(request: Request, node: EdgeAuth, x_edge_version: Annotated[str | None, Header()] = None):
    state = request.app.state
    await state.edge_nodes.touch(node.edge_node_id, x_edge_version)
    run = await state.runs.active(node.plant_id)
    return {"plant_id": node.plant_id, "run": jsonable_encoder(run.to_json()) if run else None}


@router.post("/ingest/telemetry")
async def ingest_telemetry(request: Request, body: IngestRequest, node: EdgeAuth):
    state = request.app.state
    known = state.signals
    unknown = sorted({r.tag for r in body.readings if r.tag not in known})
    if unknown:
        raise HTTPException(422, f"unknown tags: {', '.join(unknown)}")
    horizon = dt.datetime.now(dt.timezone.utc) + MAX_FUTURE_SKEW
    if any(r.observed_at > horizon for r in body.readings):
        raise HTTPException(422, "observed_at is in the future")
    readings = [
        Reading(
            tag=r.tag,
            observed_at=r.observed_at,
            value=r.value,
            raw_value=r.raw_value,
            unit=r.unit or known[r.tag].unit,
            quality=r.quality,
            source_id=known[r.tag].source,
        )
        for r in body.readings
    ]
    try:
        inserted = await state.telemetry.insert_readings(
            node.plant_id,
            readings,
            edge_node_id=node.edge_node_id,
            release_id=await state.release_id(node.plant_id),
            run_id=body.run_id,
        )
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(409, "run_id does not exist")
    await state.edge_nodes.touch(node.edge_node_id)
    return {"accepted": inserted, "duplicates": len(readings) - inserted}

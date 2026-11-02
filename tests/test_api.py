import datetime as dt

import httpx
import psycopg
import pytest

from app.api.main import create_app
from app.api.sse import telemetry_events
from app.db import create_pool
from app.plant import load_pack
from app.repositories.edge_nodes import EdgeNodeRepository

from conftest import PACK_DIR

PLANT = "waterplant"
NODE = "EDGE-01"


def stamp(seconds=0):
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=seconds)).isoformat()


def reading(tag="FIT-301", value=2000.0, at=None, **extra):
    return {"tag": tag, "observed_at": at or stamp(), "value": value, "raw_value": value, "quality": "good", **extra}


@pytest.fixture
async def api(db_url):
    pack = load_pack(PACK_DIR)
    pool = create_pool(db_url)
    await pool.open()
    key = await EdgeNodeRepository(pool).provision(NODE, PLANT, "Plant edge gateway")
    app = create_app(pool, pack)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    client.edge = {"Authorization": f"Bearer {key}", "X-Edge-Node": NODE}
    client.pool = pool
    client.app_state = app.state
    yield client
    await client.aclose()
    await pool.close()


async def ingest(api, readings, run_id=None):
    return await api.post("/v1/ingest/telemetry", json={"run_id": run_id, "readings": readings}, headers=api.edge)


async def start_running_run(api):
    run = (await api.post("/v1/sim/runs", json={})).json()
    runs = api.app_state.runs
    await runs.mark_learning(run["id"])
    await runs.mark_running(run["id"])
    return run


async def test_edge_requests_need_valid_credentials(api):
    assert (await api.get("/v1/edge/session")).status_code == 401
    wrong = {**api.edge, "Authorization": "Bearer nope"}
    assert (await api.get("/v1/edge/session", headers=wrong)).status_code == 401
    other = {**api.edge, "X-Edge-Node": "EDGE-99"}
    assert (await api.post("/v1/ingest/telemetry", json={"readings": [reading()]}, headers=other)).status_code == 401


async def test_session_reports_the_active_run_and_marks_the_node_seen(api, db_url):
    body = (await api.get("/v1/edge/session", headers=api.edge)).json()
    assert body == {"plant_id": PLANT, "run": None}
    run = (await api.post("/v1/sim/runs", json={})).json()
    body = (await api.get("/v1/edge/session", headers={**api.edge, "X-Edge-Version": "0.1.0"})).json()
    assert body["run"]["id"] == run["id"]
    with psycopg.connect(db_url) as conn:
        seen, version = conn.execute("select last_seen_at, software_version from edge_nodes").fetchone()
    assert seen is not None and version == "0.1.0"


async def test_ingest_stores_readings_and_ignores_resends(api):
    run = (await api.post("/v1/sim/runs", json={})).json()
    batch = [reading("FIT-301", 2000.0, at=stamp(-2)), reading("PIT-301", 16.0, at=stamp(-2))]
    first = await ingest(api, batch, run["id"])
    assert first.json() == {"accepted": 2, "duplicates": 0}
    again = await ingest(api, batch, run["id"])
    assert again.json() == {"accepted": 0, "duplicates": 2}


async def test_ingest_fills_in_the_unit_from_the_plant_pack(api):
    await ingest(api, [reading("FIT-301", 1950.0)])
    latest = (await api.get("/v1/telemetry/latest")).json()
    assert latest["readings"][0]["unit"] == "L/h"


@pytest.mark.parametrize(
    "bad",
    [
        reading("NOPE-1"),
        {"tag": "FIT-301", "observed_at": stamp(), "value": None, "quality": "good"},
        reading(at="2026-11-02T10:00:00"),
        reading(at=stamp(3600)),
    ],
)
async def test_ingest_rejects_malformed_readings(api, bad):
    assert (await ingest(api, [bad])).status_code == 422


async def test_ingest_accepts_a_missing_value_when_flagged_bad(api):
    bad = {"tag": "FIT-301", "observed_at": stamp(), "value": None, "quality": "bad"}
    assert (await ingest(api, [bad])).json()["accepted"] == 1


async def test_ingest_rejects_an_unknown_run(api):
    r = await ingest(api, [reading()], run_id="00000000-0000-0000-0000-000000000000")
    assert r.status_code == 409


async def test_latest_and_history_follow_the_stream(api):
    run = (await api.post("/v1/sim/runs", json={})).json()
    await ingest(api, [reading("FIT-301", 2000.0, at=stamp(-3))], run["id"])
    await ingest(api, [reading("FIT-301", 1940.0, at=stamp(-1))], run["id"])
    latest = (await api.get("/v1/telemetry/latest")).json()
    assert latest["readings"][0]["value"] == 1940.0
    assert latest["readings"][0]["run_id"] == run["id"]
    assert latest["run"]["id"] == run["id"]
    points = (await api.get("/v1/telemetry/history", params={"tag": "FIT-301", "seconds": 60})).json()["points"]
    assert [p["value"] for p in points] == [2000.0, 1940.0]
    assert (await api.get("/v1/telemetry/history", params={"tag": "NOPE"})).status_code == 404


async def test_plant_lists_every_streamed_signal(api):
    body = (await api.get("/v1/plant")).json()
    assert body["plant_id"] == PLANT and len(body["signals"]) == 14
    flow = next(s for s in body["signals"] if s["tag"] == "FIT-301")
    assert flow["unit"] == "L/h" and flow["limits"] == {"nominal": 2000}


async def test_run_lifecycle(api):
    assert (await api.get("/v1/sim/runs/current")).json() == {"run": None}
    created = await api.post("/v1/sim/runs", json={"clock_speed": 2})
    assert created.status_code == 201 and created.json()["status"] == "starting"
    run_id = created.json()["id"]
    assert (await api.post("/v1/sim/runs", json={})).status_code == 409
    assert (await api.get("/v1/sim/runs/current")).json()["run"]["id"] == run_id
    assert (await api.post(f"/v1/sim/runs/{run_id}/heartbeat")).status_code == 204
    assert (await api.post(f"/v1/sim/runs/{run_id}/stop")).status_code == 204
    assert (await api.post(f"/v1/sim/runs/{run_id}/heartbeat")).status_code == 404
    assert (await api.post(f"/v1/sim/runs/{run_id}/stop")).status_code == 404
    assert (await api.post("/v1/sim/runs", json={})).status_code == 201


async def test_clock_speed_is_limited(api):
    assert (await api.post("/v1/sim/runs", json={"clock_speed": 50})).status_code == 422


async def test_events_wait_for_the_baseline(api):
    run = (await api.post("/v1/sim/runs", json={})).json()
    event = {"kind": "scenario", "payload": {"name": "production_decline"}}
    assert (await api.post(f"/v1/sim/runs/{run['id']}/events", json=event)).status_code == 409


async def test_scenario_and_backwash_events(api):
    run = await start_running_run(api)
    url = f"/v1/sim/runs/{run['id']}/events"
    backwash = {"kind": "valve_action", "payload": {"action": "backwash_completed"}}
    assert (await api.post(url, json=backwash)).status_code == 409
    scenario = {"kind": "scenario", "payload": {"name": "production_decline"}}
    assert (await api.post(url, json=scenario)).status_code == 201
    await api.app_state.runs.set_scenario(run["id"], "production_decline")
    assert (await api.post(url, json=backwash)).status_code == 201
    assert (await api.post(url, json={"kind": "scenario", "payload": {"name": "other"}})).status_code == 422
    assert (await api.post(url, json={"kind": "valve_action", "payload": {"action": "other"}})).status_code == 422


async def test_stream_replays_rows_after_a_cursor(api):
    await ingest(api, [reading("FIT-301", 2000.0, at=stamp(-2)), reading("PIT-301", 16.0, at=stamp(-1))])
    events = telemetry_events(api.app_state.telemetry, PLANT, 0, poll_s=0.01)
    first = await anext(events)
    assert first.startswith("id: ") and "event: telemetry" in first
    assert "FIT-301" in first and "PIT-301" in first
    await events.aclose()


async def test_stream_sends_keepalives_when_quiet(api):
    events = telemetry_events(api.app_state.telemetry, PLANT, 10**9, poll_s=0.01, keepalive_s=0.0)
    assert await anext(events) == ": keepalive\n\n"
    await events.aclose()


async def test_flags_are_listed_newest_first(api, db_url):
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute(
            "insert into signal_flags (plant_id, severity, tags, summary) values (%s, 'warning', '{FIT-301}', 'older')",
            (PLANT,),
        )
        conn.execute(
            "insert into signal_flags (plant_id, severity, tags, summary) values (%s, 'critical', '{FIT-301}', 'newer')",
            (PLANT,),
        )
    flags = (await api.get("/v1/flags")).json()["flags"]
    assert [f["summary"] for f in flags] == ["newer", "older"]


async def test_plant_reports_that_simulation_is_available(api):
    assert (await api.get("/v1/plant")).json()["simulation"] is True


async def test_simulation_controls_are_refused_for_a_live_plant(db_url):
    pack = load_pack(PACK_DIR)
    pool = create_pool(db_url)
    await pool.open()
    try:
        app = create_app(pool, pack, simulation_enabled=False)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get("/v1/plant")).json()["simulation"] is False
            assert (await client.post("/v1/sim/runs", json={})).status_code == 403
    finally:
        await pool.close()

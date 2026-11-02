import datetime as dt

import httpx
import psycopg
import pytest

from app.api.main import create_app
from app.db import create_pool
from app.edge.agent import AgentConfig, EdgeAgent
from app.edge.buffer import OutboxBuffer
from app.edge.observation import Observation
from app.edge.poller import ModbusPoller
from app.edge.uplink import Uplink
from app.plant import load_pack
from app.plant.registers import build_plan
from app.repositories.edge_nodes import EdgeNodeRepository
from app.repositories.runs import RunRepository
from app.simulator.plc import PlcServer
from app.simulator.runner import SimulatorConfig, SimulatorRunner

from conftest import PACK_DIR, free_port

PLANT = "waterplant"
NODE = "EDGE-01"
NOW = dt.datetime(2026, 11, 2, 10, 0, 0, tzinfo=dt.timezone.utc)


@pytest.fixture(scope="module")
def pack():
    return load_pack(PACK_DIR)


@pytest.fixture(scope="module")
def plan(pack):
    return build_plan(pack, "SRC-PLC1")


def obs(tag="FIT-301", value=2000.0, offset=0, quality="good"):
    return Observation(tag, NOW + dt.timedelta(seconds=offset), value, value, "L/h", quality)


class FlakyTransport(httpx.AsyncBaseTransport):
    def __init__(self, inner):
        self.inner = inner
        self.mode = "up"

    async def handle_async_request(self, request):
        if self.mode == "down":
            raise httpx.ConnectError("unreachable")
        response = await self.inner.handle_async_request(request)
        if self.mode == "lose_response":
            raise httpx.ReadError("response lost")
        return response


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


@pytest.fixture
async def site(db_url, pack, plan, tmp_path):
    pool = create_pool(db_url)
    await pool.open()
    key = await EdgeNodeRepository(pool).provision(NODE, PLANT, "Plant edge gateway")
    app = create_app(pool, pack)
    transport = FlakyTransport(httpx.ASGITransport(app=app))
    client = httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {key}", "X-Edge-Node": NODE},
    )
    port = free_port()
    plc = PlcServer(plan, "127.0.0.1", port)
    await plc.start()
    clock = FakeClock()
    runner = SimulatorRunner(
        RunRepository(pool), pack.instruments, plc,
        SimulatorConfig(plant_id=PLANT, baseline_s=10.0), clock=clock,
    )
    poller = ModbusPoller(plan, "127.0.0.1", port, timeout_s=1.0)
    buffer = OutboxBuffer(tmp_path / "outbox.db")
    agent = EdgeAgent(poller, buffer, Uplink(client, version="test"), AgentConfig())

    class Site:
        pass

    s = Site()
    s.pool, s.client, s.transport, s.plc, s.runner, s.clock = pool, client, transport, plc, runner, clock
    s.poller, s.buffer, s.agent, s.db_url, s.key = poller, buffer, agent, db_url, key

    async def advance(seconds, every=0):
        for i in range(int(seconds)):
            clock.advance(1.0)
            await runner.tick()
            if every and i % every == 0:
                await agent.poll_once()
                await agent.flush_once()

    s.advance = advance
    yield s
    await poller.close()
    await plc.stop()
    buffer.close()
    await client.aclose()
    await pool.close()


def rows(site, sql, *params):
    with psycopg.connect(site.db_url) as conn:
        return conn.execute(sql, params).fetchall()


async def test_observation_survives_a_json_round_trip():
    original = obs()
    assert Observation.from_json(original.to_json()) == original


def test_buffer_returns_oldest_first_and_one_run_at_a_time(tmp_path):
    buffer = OutboxBuffer(tmp_path / "b.db")
    buffer.add("run-a", [obs(offset=0), obs(offset=1)])
    buffer.add("run-b", [obs(offset=2)])
    buffer.add("run-a", [obs(offset=3)])
    first = buffer.next_batch(10)
    assert first.run_id == "run-a" and len(first.observations) == 3
    buffer.remove(first.ids)
    second = buffer.next_batch(10)
    assert second.run_id == "run-b" and len(second.observations) == 1
    buffer.remove(second.ids)
    assert buffer.next_batch(10) is None


def test_buffer_survives_a_restart_and_honours_the_cap(tmp_path):
    path = tmp_path / "b.db"
    buffer = OutboxBuffer(path, max_rows=5)
    buffer.add(None, [obs(offset=i) for i in range(8)])
    buffer.close()
    reopened = OutboxBuffer(path, max_rows=5)
    batch = reopened.next_batch(10)
    assert len(batch.observations) == 5
    assert batch.observations[0].observed_at == NOW + dt.timedelta(seconds=3)


async def test_poller_decodes_what_the_plc_publishes(site):
    site.plc.publish({p.tag: 1.0 for p in site.poller._plan.points} | {"FIT-301": 1960.0, "PIT-301": 15.8, "FC-RO": 0.0})
    result = {o.tag: o for o in await site.poller.poll()}
    assert len(result) == 14
    assert result["FIT-301"].value == 1960.0 and result["FIT-301"].raw_value == 1960.0
    assert result["PIT-301"].value == pytest.approx(15.8) and result["PIT-301"].raw_value == 158.0
    assert result["FC-RO"].value == 0.0 and result["YS-101"].value == 1.0
    assert {o.quality for o in result.values()} == {"good"}


async def test_poller_reports_bad_quality_when_the_plc_is_unreachable(site, plan):
    await site.plc.stop()
    result = await site.poller.poll()
    assert len(result) == 14
    assert all(o.value is None and o.quality == "bad" for o in result)
    port = site.poller._client.comm_params.port
    site.plc = PlcServer(plan, "127.0.0.1", port)
    await site.plc.start()
    site.plc.publish({p.tag: 1.0 for p in plan.points})
    recovered = await site.poller.poll()
    assert all(o.quality == "good" for o in recovered)


async def test_nothing_is_polled_until_a_run_starts(site):
    await site.agent.refresh_session()
    assert site.agent.active is False
    assert await site.agent.poll_once() == 0
    assert site.buffer.count() == 0


async def test_readings_travel_from_the_plc_to_the_database(site):
    run = (await site.client.post("/v1/sim/runs", json={})).json()
    await site.advance(12)
    await site.agent.refresh_session()
    assert site.agent.active and site.agent.run_id == run["id"]
    assert await site.agent.poll_once() == 14
    assert await site.agent.flush_once() == 14
    assert site.buffer.count() == 0
    stored = rows(site, "select count(*), min(provenance), min(edge_node_id), min(run_id::text), min(quality) from telemetry")
    assert stored == [(14, "edge", NODE, run["id"], "good")]
    assert rows(site, "select last_seen_at is not null from edge_nodes") == [(True,)]


async def test_a_production_decline_shows_up_in_the_stored_data(site):
    run = (await site.client.post("/v1/sim/runs", json={})).json()
    await site.advance(12)
    await site.agent.refresh_session()
    await site.advance(5, every=1)
    event = {"kind": "scenario", "payload": {"name": "production_decline"}}
    assert (await site.client.post(f"/v1/sim/runs/{run['id']}/events", json=event)).status_code == 201
    await site.advance(75, every=1)
    flow = {r[0]: r[1] for r in rows(site, "select tag, value from telemetry_latest")}
    assert flow["FIT-301"] == pytest.approx(1500, abs=70)
    assert flow["PIT-301"] > 14.5 and flow["PSL-301"] == 1.0 and flow["FC-RO"] == 0.0
    first, last = rows(
        site,
        "select (array_agg(value order by observed_at))[1], (array_agg(value order by observed_at desc))[1] "
        "from telemetry where tag = 'FIT-301'",
    )[0]
    assert first == pytest.approx(2000, abs=100) and last < 1600


async def test_data_is_held_while_the_api_is_down_and_sent_once_it_returns(site):
    await site.client.post("/v1/sim/runs", json={})
    await site.advance(2)
    await site.agent.refresh_session()
    site.transport.mode = "down"
    for _ in range(3):
        await site.agent.poll_once()
    assert await site.agent.flush_once() == 0
    assert site.buffer.count() == 42
    site.transport.mode = "up"
    assert await site.agent.flush_once() == 42
    assert site.buffer.count() == 0
    assert rows(site, "select count(*) from telemetry") == [(42,)]


async def test_a_lost_response_does_not_create_duplicate_rows(site):
    await site.client.post("/v1/sim/runs", json={})
    await site.advance(2)
    await site.agent.refresh_session()
    for _ in range(2):
        await site.agent.poll_once()
    site.transport.mode = "lose_response"
    assert await site.agent.flush_once() == 0
    assert site.buffer.count() == 28
    assert rows(site, "select count(*) from telemetry") == [(28,)]
    site.transport.mode = "up"
    await site.agent.flush_once()
    assert site.buffer.count() == 0
    assert rows(site, "select count(*) from telemetry") == [(28,)]


async def test_a_run_that_stops_keeps_its_last_state_if_the_api_is_unreachable(site):
    await site.client.post("/v1/sim/runs", json={})
    await site.agent.refresh_session()
    run_id = site.agent.run_id
    site.transport.mode = "down"
    await site.agent.refresh_session()
    assert site.agent.active and site.agent.run_id == run_id


async def test_a_batch_the_api_rejects_is_dropped(site):
    site.buffer.add(None, [obs(tag="NOPE-1")])
    assert await site.agent.flush_once() == 0
    assert site.buffer.count() == 0


async def test_rotating_a_key_locks_out_the_old_one(site):
    new_key = await EdgeNodeRepository(site.pool).provision(NODE, PLANT, "Plant edge gateway")
    assert new_key != site.key
    assert (await site.client.get("/v1/edge/session")).status_code == 401
    ok = await site.client.get("/v1/edge/session", headers={"Authorization": f"Bearer {new_key}"})
    assert ok.status_code == 200


async def test_continuous_mode_streams_without_a_run(site):
    site.agent._config = AgentConfig(always_on=True)
    await site.agent.refresh_session()
    assert site.agent.active and site.agent.run_id is None
    assert await site.agent.poll_once() == 14
    assert await site.agent.flush_once() == 14
    assert rows(site, "select count(*), count(run_id), min(provenance) from telemetry") == [(14, 0, "edge")]


async def test_continuous_mode_keeps_collecting_while_the_api_is_down(site):
    site.agent._config = AgentConfig(always_on=True)
    site.transport.mode = "down"
    await site.agent.refresh_session()
    assert await site.agent.poll_once() == 14
    assert site.buffer.count() == 14

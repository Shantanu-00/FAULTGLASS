import statistics

import pytest
from pymodbus.client import AsyncModbusTcpClient

from app.db import create_pool
from app.plant import load_pack
from app.plant.registers import build_plan
from app.repositories.runs import ActiveRunExists, RunRepository
from app.simulator.model import PROFILES, PlantModel
from app.simulator.plc import PlcServer
from app.simulator.runner import SimulatorConfig, SimulatorRunner

from conftest import PACK_DIR, free_port

PLANT = "waterplant"


@pytest.fixture(scope="module")
def pack():
    return load_pack(PACK_DIR)


@pytest.fixture(scope="module")
def plan(pack):
    return build_plan(pack, "SRC-PLC1")


def run_model(model, seconds, dt=1.0):
    samples = []
    for _ in range(int(seconds / dt)):
        model.step(dt)
        samples.append(model.readings())
    return samples


def test_register_plan_covers_every_streamed_point(pack, plan):
    streamed = {i.tag for i in pack.instruments if i.observe == "telemetry"}
    assert {p.tag for p in plan.points} == streamed
    assert (plan.size("discrete"), plan.size("input"), plan.size("holding")) == (7, 5, 2)


def test_registers_round_trip_within_one_count(plan):
    for point in plan.points:
        if point.dtype == "bool":
            assert point.decode(point.encode(1.0)) == 1.0
            assert point.decode(point.encode(0.0)) == 0.0
        else:
            nominal = {"AIT-301": 15.0, "PIT-301": 16.0, "PIT-302": 180.0, "JI-301": 9.0, "FIT-301": 2000.0}.get(point.tag, 1.0)
            step = 1.0 if point.scaling is None else (point.scaling.eng_max - point.scaling.eng_min) / (point.scaling.raw_max - point.scaling.raw_min)
            assert abs(point.decode(point.encode(nominal)) - nominal) <= step


def test_model_covers_every_streamed_point(pack):
    model = PlantModel(pack.instruments, seed=1)
    assert set(model.readings()) == {i.tag for i in pack.instruments if i.observe == "telemetry"}


def test_baseline_stays_close_to_nominal(pack):
    model = PlantModel(pack.instruments, seed=3)
    samples = run_model(model, 600)
    nominal = {i.tag: i.limits.nominal for i in pack.instruments if i.tag in PROFILES}
    for tag, profile in PROFILES.items():
        values = [s[tag] for s in samples]
        assert abs(statistics.mean(values) - nominal[tag]) < profile.noise
        assert max(abs(v - nominal[tag]) for v in values) < 5 * profile.noise
    assert all(s["PSL-301"] == 1.0 and s["FC-RO"] == 0.0 and s["ST-RO"] == 1.0 for s in samples)


def test_decline_takes_a_quarter_off_production_without_tripping(pack):
    model = PlantModel(pack.instruments, seed=3)
    run_model(model, 60)
    model.start_decline()
    assert model.phase == "declining"
    samples = run_model(model, 90)
    tail = samples[-20:]
    assert model.phase == "degraded"
    assert abs(statistics.mean(s["FIT-301"] for s in tail) - 1500) < 30
    assert abs(statistics.mean(s["PIT-301"] for s in tail) - 15.1) < 0.15
    assert statistics.mean(s["JI-301"] for s in tail) < 7.5
    assert statistics.mean(s["AIT-301"] for s in tail) > 16.5
    assert all(s["PSL-301"] == 1.0 and s["PSH-301"] == 1.0 and s["FC-RO"] == 0.0 for s in samples)


def test_decline_is_gradual(pack):
    model = PlantModel(pack.instruments, seed=3)
    model.start_decline(ramp_s=60)
    run_model(model, 30)
    assert 0.45 < model.fouling < 0.55


def test_recovery_returns_most_of_the_flow(pack):
    model = PlantModel(pack.instruments, seed=3)
    model.start_decline()
    run_model(model, 70)
    assert model.begin_recovery()
    assert model.phase == "recovering"
    tail = run_model(model, 60)[-20:]
    assert abs(statistics.mean(s["FIT-301"] for s in tail) - 1850) < 30


def test_recovery_does_nothing_when_nothing_is_wrong(pack):
    model = PlantModel(pack.instruments, seed=3)
    assert not model.begin_recovery()


def test_same_seed_gives_same_readings(pack):
    a = run_model(PlantModel(pack.instruments, seed=9), 20)
    b = run_model(PlantModel(pack.instruments, seed=9), 20)
    c = run_model(PlantModel(pack.instruments, seed=10), 20)
    assert a == b and a != c


def test_low_suction_opens_the_pressure_switch(pack):
    model = PlantModel(pack.instruments, seed=3)
    model.fouling = 2.0
    assert model.readings()["PSL-301"] == 0.0


async def test_plc_serves_published_values_over_modbus(pack, plan):
    port = free_port()
    plc = PlcServer(plan, "127.0.0.1", port)
    await plc.start()
    client = AsyncModbusTcpClient("127.0.0.1", port=port)
    try:
        await client.connect()
        values = {p.tag: 1.0 for p in plan.points}
        values.update({"FC-RO": 0.0, "PSL-301": 0.0, "AIT-301": 15.0, "PIT-301": 16.0, "PIT-302": 180.0, "JI-301": 9.0, "FIT-301": 2000.0})
        plc.publish(values)
        bits = await client.read_discrete_inputs(0, count=plan.size("discrete"), device_id=plan.unit_id)
        inputs = await client.read_input_registers(0, count=plan.size("input"), device_id=plan.unit_id)
        holding = await client.read_holding_registers(0, count=plan.size("holding"), device_id=plan.unit_id)
        index = plan.tag_index()
        assert bits.bits[index["PSL-301"].offset] is False
        assert bits.bits[index["YS-101"].offset] is True
        assert inputs.registers[index["FIT-301"].offset] == 2000
        assert inputs.registers[index["PIT-301"].offset] == 160
        assert holding.registers == [1, 0]

        plc.publish({**values, "FIT-301": 1500.0})
        inputs = await client.read_input_registers(0, count=plan.size("input"), device_id=plan.unit_id)
        assert inputs.registers[index["FIT-301"].offset] == 1500

        refused = await client.write_register(0, 5, device_id=plan.unit_id)
        assert refused.isError()
    finally:
        client.close()
        await plc.stop()


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class CapturingPlc:
    def __init__(self):
        self.values = {}

    def publish(self, values):
        self.values = values


@pytest.fixture
async def harness(db_url, pack):
    pool = create_pool(db_url)
    await pool.open()
    runs = RunRepository(pool)
    clock = FakeClock()
    plc = CapturingPlc()
    config = SimulatorConfig(plant_id=PLANT, baseline_s=10.0, heartbeat_timeout_s=30.0)
    runner = SimulatorRunner(runs, pack.instruments, plc, config, clock=clock)

    async def advance(seconds, step=1.0):
        for _ in range(int(seconds / step)):
            clock.advance(step)
            await runner.tick()

    yield runs, runner, plc, advance
    await pool.close()


async def test_only_one_run_can_be_active(harness):
    runs, *_ = harness
    await runs.create(PLANT, seed=1)
    with pytest.raises(ActiveRunExists):
        await runs.create(PLANT, seed=2)


async def test_run_learns_a_baseline_before_it_is_running(harness):
    runs, runner, plc, advance = harness
    run = await runs.create(PLANT, seed=1)
    await advance(1)
    assert (await runs.get(run.id)).status == "learning"
    await advance(5)
    assert (await runs.get(run.id)).status == "learning"
    await advance(6)
    ready = await runs.get(run.id)
    assert ready.status == "running" and ready.baseline_ready_at is not None
    assert abs(plc.values["FIT-301"] - 2000) < 100


async def test_clock_speed_shortens_the_baseline(harness):
    runs, runner, plc, advance = harness
    run = await runs.create(PLANT, seed=1, clock_speed=5)
    await advance(4)
    assert (await runs.get(run.id)).status == "running"


async def test_production_decline_then_backwash_recovery(harness):
    runs, runner, plc, advance = harness
    run = await runs.create(PLANT, seed=1)
    await advance(12)
    await runs.add_event(run.id, "scenario", {"name": "production_decline"})
    await advance(75)
    assert abs(plc.values["FIT-301"] - 1500) < 70
    assert (await runs.get(run.id)).scenario == "production_decline"
    await runs.add_event(run.id, "valve_action", {"action": "backwash_completed"})
    await advance(40)
    assert abs(plc.values["FIT-301"] - 1850) < 70
    assert plc.values["PSL-301"] == 1.0 and plc.values["FC-RO"] == 0.0


async def test_scenario_sent_during_baseline_is_ignored(harness):
    runs, runner, plc, advance = harness
    run = await runs.create(PLANT, seed=1)
    await advance(3)
    await runs.add_event(run.id, "scenario", {"name": "production_decline"})
    await advance(30)
    assert abs(plc.values["FIT-301"] - 2000) < 100
    assert (await runs.get(run.id)).scenario is None


async def test_run_stops_when_the_console_goes_quiet(harness, db_url):
    import psycopg

    runs, runner, plc, advance = harness
    run = await runs.create(PLANT, seed=1)
    await advance(2)
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute("update sim_runs set last_heartbeat_at = now() - interval '60 seconds' where id = %s", (run.id,))
    await advance(1)
    assert await runs.active(PLANT) is None
    with psycopg.connect(db_url) as conn:
        assert conn.execute("select stop_reason from sim_runs where id = %s", (run.id,)).fetchone()[0] == "heartbeat_lost"


async def test_a_heartbeat_keeps_the_run_alive(harness):
    runs, runner, plc, advance = harness
    run = await runs.create(PLANT, seed=1)
    await advance(2)
    assert await runs.heartbeat(run.id)
    await advance(1)
    assert (await runs.active(PLANT)).id == run.id


async def test_plant_keeps_publishing_when_idle(harness):
    runs, runner, plc, advance = harness
    await advance(3)
    assert abs(plc.values["FIT-301"] - 2000) < 100


async def test_events_cannot_be_added_to_a_stopped_run(harness):
    runs, *_ = harness
    run = await runs.create(PLANT, seed=1)
    await runs.stop(run.id, "requested")
    assert await runs.add_event(run.id, "scenario", {"name": "production_decline"}) is None

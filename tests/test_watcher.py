import datetime as dt

import psycopg
import pytest

from app.db import create_pool
from app.plant import load_pack
from app.repositories.edge_nodes import EdgeNodeRepository
from app.repositories.flags import FlagRepository
from app.repositories.runs import RunRepository
from app.repositories.telemetry import Reading, TelemetryRepository
from app.watcher.card import build_card
from app.watcher.spark import SparkReply, check_against_card, parse_verdict
from app.watcher.worker import SparkWatcher, WatcherConfig

from conftest import PACK_DIR

PLANT = "waterplant"
BASELINE = {"FIT-301": [2000.0, 1990.0, 2010.0, 2000.0], "PIT-301": [16.0, 16.1, 15.9, 16.0],
            "PIT-302": [180.0, 179.0, 181.0, 180.0], "JI-301": [9.0, 9.1, 8.9, 9.0], "AIT-301": [15.0, 15.2, 14.8, 15.0]}
DECLINE = {"FIT-301": [1500.0, 1510.0], "PIT-301": [15.1, 15.1], "PIT-302": [174.0, 174.0],
           "JI-301": [7.2, 7.2], "AIT-301": [17.0, 17.0]}
STATES = {"YS-301": "RUNNING", "FC-RO": "NONE"}


def make_card(recent, states=STATES):
    pack = load_pack(PACK_DIR)
    return build_card(PLANT, "run-1", pack.instruments, BASELINE, recent, states)


def test_card_computes_baseline_spread_and_distance():
    card = make_card(DECLINE)
    flow = card.by_tag()["FIT-301"]
    assert flow.baseline == pytest.approx(2000.0)
    assert flow.current == pytest.approx(1505.0)
    assert flow.pct == pytest.approx(-24.75)
    assert flow.sigma < -5  # well past the FLAG gate
    assert flow.deviating == "flag"
    assert "FIT-301" in card.text() and "sigma" in card.text()


def test_card_stale_signal_cannot_deviate():
    pack = load_pack(PACK_DIR)
    card = build_card(PLANT, "run-1", pack.instruments, BASELINE, DECLINE, STATES, stale_tags={"FIT-301"})
    assert card.by_tag()["FIT-301"].deviating is None


def test_parse_verdict_keeps_only_card_tags():
    card = make_card(DECLINE)
    verdict = parse_verdict("FLAG\nFlow and suction moved together.\nTAGS: FIT-301, PIT-301, NOPE-9", card)
    assert verdict.verdict == "FLAG"
    assert verdict.tags == ["FIT-301", "PIT-301"]


def test_card_check_rejects_a_flag_the_numbers_do_not_support():
    card = make_card({"FIT-301": [2001.0, 1999.0]})
    verdict = parse_verdict("FLAG\nFlow collapsed.\nTAGS: FIT-301", card)
    assert check_against_card(verdict, card) == ([], None)


def test_card_check_maps_flag_to_critical():
    card = make_card(DECLINE)
    verdict = parse_verdict("FLAG\nFlow down with suction and current.\nTAGS: FIT-301, PIT-301, JI-301", card)
    validated, severity = check_against_card(verdict, card)
    assert validated == ["FIT-301", "PIT-301", "JI-301"]
    assert severity == "critical"


class FakeSpark:
    model = "meta-models/muse-spark-open-1026"

    def __init__(self, reply: str):
        self.reply = reply
        self.cards: list[str] = []

    async def classify(self, card_text: str) -> SparkReply:
        self.cards.append(card_text)
        return SparkReply(content=self.reply, latency_ms=42, model=self.model)


async def seed_running_run(db_url):
    """A running run with a baseline window and a declining recent window."""
    pack = load_pack(PACK_DIR)
    pool = create_pool(db_url)
    await pool.open()
    runs, telemetry = RunRepository(pool), TelemetryRepository(pool)
    await EdgeNodeRepository(pool).provision("EDGE-01", PLANT, "Plant edge gateway")
    run = await runs.create(PLANT, seed=7)
    await runs.mark_learning(run.id)
    await runs.mark_running(run.id)
    # Backdate the run so the baseline window does not overlap the recent window,
    # as it never does live (learning takes SIM_BASELINE_S, then minutes pass).
    async with pool.connection() as conn:
        await conn.execute(
            "update sim_runs set started_at = now() - interval '10 minutes', "
            "baseline_ready_at = now() - interval '9 minutes' where id = %s",
            (run.id,),
        )
    run = await runs.get(run.id)  # fresh baseline_ready_at bounds the baseline window
    unit = {i.tag: i.unit for i in pack.instruments}
    span = run.baseline_ready_at - run.started_at
    rows = [
        Reading(tag, run.started_at + span * (n + 1) / 10, value, None, unit[tag], "good", "SRC-PLC1")
        for tag, values in BASELINE.items() for n, value in enumerate(values)
    ]
    await telemetry.insert_readings(PLANT, rows, edge_node_id="EDGE-01", release_id=None, run_id=run.id)
    now = dt.datetime.now(dt.timezone.utc)
    recent = [
        Reading(tag, now - dt.timedelta(seconds=1) + dt.timedelta(milliseconds=100 * n),
                value, None, unit[tag], "good", "SRC-PLC1")
        for tag, values in DECLINE.items() for n, value in enumerate(values)
    ]
    await telemetry.insert_readings(PLANT, recent, edge_node_id="EDGE-01", release_id=None, run_id=run.id)
    return pool, run


def watcher_for(pool, spark):
    pack = load_pack(PACK_DIR)
    return SparkWatcher(
        RunRepository(pool), TelemetryRepository(pool), FlagRepository(pool),
        spark, pack.instruments, WatcherConfig(plant_id=PLANT),
    )


async def test_watcher_writes_flag_and_opens_incident(db_url):
    pool, run = await seed_running_run(db_url)
    try:
        spark = FakeSpark("FLAG\nPermeate flow fell with suction pressure and motor current.\nTAGS: FIT-301, PIT-301, JI-301")
        watcher = watcher_for(pool, spark)
        assert await watcher.tick() == "flagged"
        assert await watcher.tick() == "duplicate"  # same run + tags: no flag spam
        with psycopg.connect(db_url) as conn:
            flags = conn.execute("select severity, tags, model, incident_id from signal_flags").fetchall()
            incidents = conn.execute("select status, data_origin, models_used from incidents").fetchall()
            trace = conn.execute("select kind, actor from incident_trace").fetchall()
        assert len(flags) == 1
        assert flags[0][0] == "critical" and flags[0][1] == ["FIT-301", "PIT-301", "JI-301"]
        assert flags[0][3] is not None
        assert incidents == [("open", "live", ["meta-models/muse-spark-open-1026"])]
        assert trace == [("alarm", "model")]
    finally:
        await pool.close()


async def test_watcher_normal_writes_nothing(db_url):
    pool, run = await seed_running_run(db_url)
    try:
        normal = watcher_for(pool, FakeSpark("NORMAL\nAll signals near baseline.\nTAGS: none"))
        assert await normal.tick() == "normal"
        with psycopg.connect(db_url) as conn:
            assert conn.execute("select count(*) from signal_flags").fetchone()[0] == 0
            assert conn.execute("select count(*) from incidents").fetchone()[0] == 0
    finally:
        await pool.close()

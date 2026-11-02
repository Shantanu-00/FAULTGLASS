import datetime as dt
import uuid

import psycopg
import pytest

NOW = dt.datetime(2026, 11, 2, 10, 0, 0, tzinfo=dt.timezone.utc)

INSERT_READING = """
insert into telemetry (plant_id, tag, observed_at, value, unit, quality, provenance, run_id)
values ('waterplant', %s, %s, %s, 'L/h', %s, 'edge', %s)
on conflict (plant_id, tag, observed_at) do nothing
"""


def new_run(conn, plant="waterplant"):
    return conn.execute(
        "insert into sim_runs (plant_id, seed) values (%s, 7) returning id", (plant,)
    ).fetchone()[0]


def test_duplicate_readings_are_ignored(conn):
    run = new_run(conn)
    for _ in range(3):
        conn.execute(INSERT_READING, ("FIT-301", NOW, 2000.0, "good", run))
    assert conn.execute("select count(*) from telemetry").fetchone()[0] == 1


def test_latest_keeps_the_newest_observation(conn):
    run = new_run(conn)
    newer = NOW + dt.timedelta(seconds=5)
    conn.execute(INSERT_READING, ("FIT-301", newer, 1900.0, "good", run))
    conn.execute(INSERT_READING, ("FIT-301", NOW, 2000.0, "good", run))
    value, observed = conn.execute(
        "select value, observed_at from telemetry_latest where tag = 'FIT-301'"
    ).fetchone()
    assert value == 1900.0 and observed == newer


def test_good_reading_requires_a_value(conn):
    run = new_run(conn)
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(INSERT_READING, ("FIT-301", NOW, None, "good", run))
    conn.execute(INSERT_READING, ("FIT-301", NOW, None, "bad", run))


def test_reading_must_reference_an_existing_run(conn):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        conn.execute(INSERT_READING, ("FIT-301", NOW, 2000.0, "good", uuid.uuid4()))


def test_only_one_active_run_per_plant(conn):
    first = new_run(conn)
    with pytest.raises(psycopg.errors.UniqueViolation):
        new_run(conn)
    new_run(conn, plant="other")
    conn.execute(
        "update sim_runs set status = 'stopped', stopped_at = now(), stop_reason = 'requested' where id = %s",
        (first,),
    )
    new_run(conn)


def test_stopped_run_needs_a_stop_time(conn):
    run = new_run(conn)
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("update sim_runs set status = 'stopped' where id = %s", (run,))


def test_events_are_removed_with_their_run(conn):
    run = new_run(conn)
    conn.execute("insert into sim_events (run_id, kind, payload) values (%s, 'scenario', '{}')", (run,))
    conn.execute("update sim_runs set status = 'stopped', stopped_at = now() where id = %s", (run,))
    conn.execute("delete from sim_runs where id = %s", (run,))
    assert conn.execute("select count(*) from sim_events").fetchone()[0] == 0


def test_flag_needs_at_least_one_tag(conn):
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "insert into signal_flags (plant_id, severity, tags, summary) values ('waterplant', 'warning', '{}', 'x')"
        )
    conn.execute(
        "insert into signal_flags (plant_id, severity, tags, summary) "
        "values ('waterplant', 'warning', '{FIT-301}', 'flow below baseline')"
    )

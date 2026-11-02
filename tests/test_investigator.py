import datetime as dt
import json

import httpx
import psycopg
import pytest

from app.api.main import create_app
from app.db import create_pool
from app.investigator.wonder import WonderReply
from app.investigator.worker import Investigator, InvestigatorConfig
from app.plant import load_pack
from app.repositories.flags import FlagRepository
from app.repositories.investigation import InvestigationRepository
from app.repositories.runs import RunRepository
from app.repositories.telemetry import Reading, TelemetryRepository
from app.watcher.worker import incident_id_for

from conftest import PACK_DIR

PLANT = "waterplant"
INCIDENT = "INC-20261102-TEST01"


def call(name, args, call_id):
    return {"type": "function_call", "name": name, "call_id": call_id, "arguments": json.dumps(args)}


def message(text):
    return {"type": "message", "content": [{"type": "output_text", "text": text}]}


class ScriptedWonder:
    """Fake Wonder: plays back one scripted turn per create() call."""

    model = "muse-wonder-1.0"

    def __init__(self, turns):
        self.turns = list(turns)
        self.inputs: list[list] = []

    async def create(self, input_items, tools, *, reasoning_effort="medium"):
        self.inputs.append(list(input_items))
        output = self.turns.pop(0) if self.turns else [message("done")]
        return WonderReply(output=output, latency_ms=5, model=self.model)


async def seed_incident(db_url):
    """Live incident opened by a Spark-style flag, with decline telemetry."""
    pack = load_pack(PACK_DIR)
    pool = create_pool(db_url)
    await pool.open()
    runs, telemetry, flags = RunRepository(pool), TelemetryRepository(pool), FlagRepository(pool)
    from app.repositories.edge_nodes import EdgeNodeRepository
    await EdgeNodeRepository(pool).provision("EDGE-01", PLANT, "Plant edge gateway")
    run = await runs.create(PLANT, seed=7)
    incident_id = incident_id_for(run)
    await flags.ensure_incident(
        PLANT, incident_id, title="Signal flag: FIT-301 drifted", severity="high",
        symptoms=[{"tag": "FIT-301", "source": "spark_watcher"}], models_used=["meta-models/muse-spark-open-1026"])
    await flags.create(
        PLANT, run_id=run.id, severity="critical", tags=["FIT-301", "PIT-301", "JI-301"],
        summary="Permeate flow fell with suction pressure and motor current.",
        evidence={"signals": {"FIT-301": {"current": 1505, "baseline": 2000, "pct": -24.75}}},
        model="meta-models/muse-spark-open-1026", model_latency_ms=42, incident_id=incident_id)
    now = dt.datetime.now(dt.timezone.utc)
    unit = {i.tag: i.unit for i in pack.instruments}
    latest_values = {"FIT-301": 1505.0, "PIT-301": 15.1, "PIT-302": 174.0, "JI-301": 7.2, "AIT-301": 17.0}
    rows = [Reading(tag, now, value, None, unit[tag], "good", "SRC-PLC1")
            for tag, value in latest_values.items()]
    states = {"YS-101": 1, "YS-301": 1, "LSL-101": 1, "PSL-301": 1, "PSH-301": 1, "FC-RO": 0, "ST-RO": 1}
    rows += [Reading(tag, now, float(value), None, unit[tag], "good", "SRC-PLC1") for tag, value in states.items()]
    await telemetry.insert_readings(PLANT, rows, edge_node_id="EDGE-01", release_id=None, run_id=run.id)
    return pool, pack, incident_id


def investigator_for(pool, pack, wonder):
    return Investigator(pack, TelemetryRepository(pool), InvestigationRepository(pool),
                        RunRepository(pool), wonder, InvestigatorConfig(plant_id=PLANT))


OPENING_TURNS = [
    [call("recall_plant_memory", {"kind": "topology"}, "c1"),
     call("recall_sop", {"query": "low suction"}, "c2"),
     call("recall_incident", {"query": "flow"}, "c3")],
    [call("record_hypothesis", {"label": "H1", "statement": "Raw tank low", "status": "open"}, "c4"),
     call("record_hypothesis", {"label": "H2", "statement": "HP pump failing", "status": "open"}, "c5"),
     call("record_hypothesis", {"label": "H3", "statement": "Cartridge bank restriction", "status": "open"}, "c6"),
     call("get_latest_telemetry", {}, "c7")],
    [call("record_hypothesis", {"label": "H1", "statement": "Raw tank low", "status": "rejected",
                                "evidence_against": ["LSL-101 LEVEL_OK"]}, "c8"),
     call("record_hypothesis", {"label": "H2", "statement": "HP pump failing", "status": "rejected",
                                "evidence_against": ["YS-301 RUNNING, JI-301 down = under-fed"]}, "c9"),
     call("update_focus", {"goal": "Find cause of flow drop", "blocker": "No gauge data (no API)",
                          "next_step": "Read cartridge gauges", "focus_assets": ["CB-3F", "CB-3B"]}, "c10"),
     call("request_field_task", {"kind": "gauge_photo", "asset_ids": ["CB-3F", "CB-3B"],
                                 "tags": ["PI-203", "PI-207"],
                                 "instruction": "Photograph gauges PI-203 and PI-207 on line 3."}, "c11")],
]


async def test_investigator_recalls_records_and_pauses_for_field(db_url):
    pool, pack, incident_id = await seed_incident(db_url)
    try:
        wonder = ScriptedWonder(OPENING_TURNS)
        inv = investigator_for(pool, pack, wonder)
        assert await inv.investigate(incident_id) == "waiting_field"
        # Staged initialisation: system + incident brief only, no plant dump.
        first = wonder.inputs[0]
        assert first[0]["role"] == "system" and "incident" in first[1]["content"].lower()
        # Brief carries the flag + tag observability only: no topology dump, SOP, or past case.
        assert "SOP-RO-001" not in first[1]["content"] and "HDR-CB-IN" not in first[1]["content"]
        assert "INC-2026-0118" not in first[1]["content"]
        repo = InvestigationRepository(pool)
        hyps = await repo.hypotheses(incident_id)
        assert {h["label"]: h["status"] for h in hyps} == {"H1": "rejected", "H2": "rejected", "H3": "open"}
        tasks = await repo.field_tasks(incident_id)
        assert len(tasks) == 1 and tasks[0]["tags"] == ["PI-203", "PI-207"] and tasks[0]["status"] == "pending"
        checkpoint = await repo.checkpoint(incident_id)
        assert checkpoint["status"] == "waiting_field"
        assert checkpoint["focus"]["next_step"] == "Read cartridge gauges"
        assert checkpoint["continuation"], "encrypted-replay continuation must be persisted"
        trace_kinds = [t["kind"] for t in await repo.trace(incident_id)]
        assert trace_kinds.count("recall") == 3 and "human_task" in trace_kinds
        with psycopg.connect(db_url) as conn:
            assert conn.execute("select status from signal_flags").fetchone()[0] == "picked_up"
            assert conn.execute("select status from incidents").fetchone()[0] == "open"  # never auto-resolved
    finally:
        await pool.close()


async def test_field_completion_resumes_and_concludes(db_url):
    pool, pack, incident_id = await seed_incident(db_url)
    try:
        wonder = ScriptedWonder(OPENING_TURNS + [
            [call("record_hypothesis", {"label": "H3", "statement": "Cartridge bank restriction line 3",
                                        "status": "supported",
                                        "evidence_for": ["PI-203 22 psi front, PI-207 6 psi back"]}, "c12")],
            [message("Likely line 3 cartridge restriction. Proposed next action: backwash under SOP-MF-003. Checking in before any valve action; incident stays open.")],
        ])
        inv = investigator_for(pool, pack, wonder)
        assert await inv.investigate(incident_id) == "waiting_field"

        app = create_app(pool, pack)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            detail = (await client.get(f"/v1/incidents/{incident_id}")).json()
            assert detail["investigation"]["status"] == "waiting_field"
            assert detail["hypotheses"][0]["status"] == "rejected"
            task_id = detail["field_tasks"][0]["id"]
            bad = await client.post(f"/v1/incidents/{incident_id}/tasks/{task_id}/complete",
                                    json={"readings": {"FIT-301": 1.0}})
            assert bad.status_code == 422  # streamed tag cannot be submitted as field evidence
            done = await client.post(f"/v1/incidents/{incident_id}/tasks/{task_id}/complete",
                                     json={"readings": {"PI-203": 22.0, "PI-207": 6.0}, "note": "Line 3 back gauge much lower"})
            assert done.status_code == 200 and done.json()["readings_stored"] == 2

        assert await inv.investigate(incident_id) == "concluded"
        repo = InvestigationRepository(pool)
        hyps = {h["label"]: h["status"] for h in await repo.hypotheses(incident_id)}
        assert hyps["H3"] == "supported"
        checkpoint = await repo.checkpoint(incident_id)
        assert checkpoint["status"] == "concluded" and checkpoint["steps_used"] == 5
        with psycopg.connect(db_url) as conn:
            assert conn.execute("select count(*) from telemetry where provenance='field'").fetchone()[0] == 2
            assert conn.execute("select status from incidents").fetchone()[0] == "open"
    finally:
        await pool.close()


async def test_tools_refuse_field_gauges_and_unknown_assets(db_url):
    pool, pack, incident_id = await seed_incident(db_url)
    try:
        from app.investigator.tools import ToolExecutor
        ex = ToolExecutor(pack, TelemetryRepository(pool), InvestigationRepository(pool),
                          RunRepository(pool), incident_id=incident_id, plant_id=PLANT)
        gauge = await ex.execute("get_telemetry_window", {"tag": "PI-203"})
        assert gauge["error"] == "requires_field_task" and "line 3" in gauge["location_note"]
        assert (await ex.execute("get_telemetry_window", {"tag": "NOPE-1"}))["error"].startswith("unknown tag")
        bad_task = await ex.execute("request_field_task", {"kind": "gauge_photo", "asset_ids": ["NOPE"],
                                                           "tags": ["PI-203"], "instruction": "read it"})
        assert "unknown assets" in bad_task["error"]
        bad_tags = await ex.execute("request_field_task", {"kind": "gauge_photo", "asset_ids": ["CB-3F"],
                                                           "tags": ["FIT-301"], "instruction": "read it"})
        assert bad_tags["bad_tags"] == ["FIT-301"]  # streamed tags cannot be field tasks
    finally:
        await pool.close()

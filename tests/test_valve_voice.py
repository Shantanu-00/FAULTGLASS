import base64
import datetime as dt
import json

import httpx
import psycopg
import pytest

from app.api.main import create_app
from app.db import create_pool
from app.evidence.lever import LeverMotion, MotionFrame, Segment
from app.evidence.valve import evaluate_lever_motion
from app.evidence.voice import WonderObservationAnalyzer, compare_readings
from app.investigator.wonder import WonderReply
from app.investigator.worker import Investigator, InvestigatorConfig
from app.plant import load_pack
from app.repositories.investigation import InvestigationRepository
from app.repositories.runs import RunRepository
from app.repositories.telemetry import Reading, TelemetryRepository
from app.verifier.worker import IncidentVerifier, VerifierConfig, evaluate_recovery, is_abnormal_state

from conftest import PACK_DIR
from test_investigator import PLANT, ScriptedWonder, call, investigator_for, message, seed_incident


def test_compare_readings_agree_disagree_partial():
    assert compare_readings({"PI-201": 23.0}, {"PI-201": 22.0})["status"] == "AGREE"
    assert compare_readings({"PI-201": 10.0}, {"PI-201": 22.0})["status"] == "DISAGREE"
    assert compare_readings({"PI-201": 22.0}, {"PI-201": 22.0, "PI-202": 6.0})["status"] == "PARTIAL"
    assert compare_readings({"PI-201": 22.0}, {})["status"] == "AWAITING_PHOTO"


async def test_wonder_analyzer_extracts_and_compares():
    wonder = ScriptedWonder([[message('{"readings":{"PI-201":22,"PI-202":6},"observation":"Line 3 back gauge is low","concerns":[]}')]])
    out = await WonderObservationAnalyzer(wonder).analyze(
        "PI-201 बावीस, PI-202 सहा", {"PI-201": 22.0, "PI-202": 5.0}, ["PI-201", "PI-202"])
    assert out["structured"]["readings"] == {"PI-201": 22.0, "PI-202": 6.0}
    assert out["comparison"]["status"] == "AGREE"


def motion(plan, rests):
    """LeverMotion from (kind, seconds) periods at 10 fps and one rest position per still period."""
    frames, segments, t = [], [], 0.0
    for kind, seconds in plan:
        n = round(seconds * 10)
        segments.append(Segment(kind, t, t + n / 10, len(frames), len(frames) + n - 1))
        for _ in range(n):
            frames.append(MotionFrame(len(frames), t, True, True, kind == "moving", 0.0, (0.0, 0.0),
                                      True, True, False))
            t += 0.1
    return LeverMotion(fps=10.0, handle_seen=True, operated_ids=[1], reference_ids=[2],
                       camera_reference="handles", contact_frames=len(frames), frames=frames,
                       segments=segments, rest_positions=rests, lever_length_px=100.0)


def test_valve_policy_pass_hold_and_skip():
    rests = [(0.0, 0.0), (40.0, 30.0), (60.0, 90.0)]
    staged = [("still", 1), ("moving", 0.5), ("still", 2.5), ("moving", 0.5), ("still", 1)]
    passed = evaluate_lever_motion(motion(staged, rests), 10.0)
    assert passed.status == "passed" and passed.movements == 2 and passed.hold_s == 2.5
    assert passed.to_json()["min_hold_s"] == 2.0
    one = evaluate_lever_motion(motion([("still", 1), ("moving", 1), ("still", 1)], rests[::2]), 10.0)
    assert one.status == "violated" and one.movements == 1
    short = staged[:2] + [("still", 1.2)] + staged[3:]
    assert evaluate_lever_motion(motion(short, rests), 10.0).status == "violated"
    near = evaluate_lever_motion(motion(staged, [(0.0, 0.0), (5.0, 5.0), (60.0, 90.0)]), 10.0)
    assert near.status == "uncertain"
    assert evaluate_lever_motion(LeverMotion(fps=10.0), 10.0).status == "uncertain"


async def test_proposal_approval_video_trigger_and_resume(db_url, monkeypatch, tmp_path):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    pool, pack, incident_id = await seed_incident(db_url)
    try:
        repo = InvestigationRepository(pool)
        await repo.upsert_hypothesis(incident_id, "H3", "Cartridge bank restriction", "supported", ["differential 17 psi"], [])
        gauges = await repo.create_field_task(
            incident_id, kind="gauge_photo", asset_ids=["CB-1F", "CB-1B"], tags=["PI-201", "PI-202"],
            instruction="Photograph the bank inlet and outlet gauges")
        await repo.complete_field_task(gauges["id"], {"readings": {"PI-201": 32.0, "PI-202": 15.0}})
        wonder = ScriptedWonder([
            [call("propose_action", {"asset_id": "V-113", "action": "backwash",
                                     "rationale": "Line 3 restriction supported by gauge differential",
                                     "sop_id": "SOP-MF-003"}, "p1")],
            [message("Verified action received. Await the deterministic verifier; cartridge replacement remains recommended.")],
        ])
        inv = investigator_for(pool, pack, wonder)
        assert await inv.investigate(incident_id) == "awaiting_approval"
        proposal = (await repo.proposals(incident_id))[0]
        assert proposal["status"] == "pending"

        # Put the simulator run into a running production-decline state.
        flag = await repo.flag_for_incident(incident_id)
        runs = RunRepository(pool)
        await runs.mark_learning(flag["run_id"])
        await runs.mark_running(flag["run_id"])
        assert await runs.add_event(flag["run_id"], "scenario", {"name": "production_decline"})
        await runs.set_scenario(flag["run_id"], "production_decline")

        async def fake_analysis(sam, data, filename, mime, *, fps=None):
            return {"file_id": "file-test", "policy": {
                        "status": "passed", "reasons": ["staged"], "movements": 2, "hold_s": 2.5,
                        "segments": [], "required": "two hand-driven movements", "min_hold_s": 2.0},
                    "track": {"frames": [], "segments": [], "operated_ids": [1], "camera_reference": "handles"}}
        monkeypatch.setattr("app.evidence.valve.analyze_valve_clip", fake_analysis)
        import app.investigator.__main__ as investigator_main
        monkeypatch.setattr(investigator_main, "meta_key", lambda: "test-key")

        app = create_app(pool, pack)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            approved = await client.post(f"/v1/incidents/{incident_id}/proposals/{proposal['id']}/approve")
            assert approved.status_code == 200
            task_id = approved.json()["field_task_id"]
            video = base64.b64encode(b"fake mp4 bytes" * 20).decode()
            submitted = await client.post(
                f"/v1/incidents/{incident_id}/tasks/{task_id}/video",
                json={"video_base64": video, "mime_type": "video/mp4", "fps": 30, "note": "staged"})
            assert submitted.status_code == 200 and submitted.json()["completed"] is True

        proposal = (await repo.proposals(incident_id))[0]
        assert proposal["status"] == "executed"
        assert (await repo.field_tasks(incident_id))[0]["status"] == "completed"
        with psycopg.connect(db_url) as conn:
            assert conn.execute("select kind from sim_events order by id").fetchall()[-1][0] == "valve_action"
        assert await inv.investigate(incident_id) == "concluded"
    finally:
        await pool.close()


async def test_voice_endpoint_transcribes_and_compares(db_url, monkeypatch, tmp_path):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    pool, pack, incident_id = await seed_incident(db_url)
    try:
        repo = InvestigationRepository(pool)
        task = await repo.create_field_task(
            incident_id, kind="gauge_photo", asset_ids=["CB-3F", "CB-3B"],
            tags=["PI-201", "PI-202"], instruction="Photograph line 3 gauges")
        await repo.complete_field_task(task["id"], {"readings": {"PI-201": 22.0, "PI-202": 6.0}})

        class FakeVoice:
            def __init__(self, key): pass
            async def transcribe_wav(self, data, **kwargs):
                from app.evidence.voice import Transcript
                return Transcript(text="PI-201 बावीस आणि PI-202 सहा", session_id="s1", model="muse-voice-transcribe-1.0")
            async def aclose(self): pass

        class FakeWonder:
            def __init__(self, key): pass
            async def create(self, items, tools, *, reasoning_effort="medium"):
                return WonderReply(output=[message('{"readings":{"PI-201":22,"PI-202":6},"observation":"Line 3 outlet low","concerns":[]}')])
            async def aclose(self): pass

        import app.evidence.voice as voice_module
        import app.investigator.__main__ as investigator_main
        import app.investigator.wonder as wonder_module
        monkeypatch.setattr(voice_module, "MetaVoiceClient", FakeVoice)
        monkeypatch.setattr(wonder_module, "WonderClient", FakeWonder)
        monkeypatch.setattr(investigator_main, "meta_key", lambda: "test-key")

        wav = b"RIFF" + (36).to_bytes(4, "little") + b"WAVEfmt " + b"\x00" * 96
        app = create_app(pool, pack)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            out = await client.post(
                f"/v1/incidents/{incident_id}/tasks/{task['id']}/voice",
                json={"audio_base64": base64.b64encode(wav).decode()})
            assert out.status_code == 200
            assert out.json()["voice"]["comparison"]["status"] == "AGREE"
            detail = (await client.get(f"/v1/incidents/{incident_id}")).json()
            assert detail["voice_observations"][0]["transcript"].startswith("PI-201")
    finally:
        await pool.close()


async def test_verifier_resolves_only_after_executed_action(db_url):
    pool, pack, incident_id = await seed_incident(db_url)
    try:
        repo = InvestigationRepository(pool)
        proposal = await repo.create_proposal(
            incident_id, asset_id="V-113", action="backwash", rationale="test", sop_id="SOP-MF-003")
        await repo.set_proposal_status(proposal["id"], "executed", result={})
        with psycopg.connect(db_url) as conn:
            conn.execute("update action_proposals set executed_at = now() - interval '70 seconds' where id = %s",
                         (str(proposal["id"]),))
        flag = await repo.flag_for_incident(incident_id)
        now = dt.datetime.now(dt.timezone.utc)
        unit = {i.tag: i.unit for i in pack.instruments}
        recovered = {"FIT-301": 1850.0, "PIT-301": 15.8, "PIT-302": 178.0, "JI-301": 8.5, "AIT-301": 15.6}
        rows = [Reading(tag, now - dt.timedelta(seconds=11 - n), value, None, unit[tag], "good", "SRC-PLC1")
                for n in range(12) for tag, value in recovered.items()]
        await TelemetryRepository(pool).insert_readings(
            PLANT, rows, edge_node_id="EDGE-01", release_id=None, run_id=flag["run_id"])
        verifier = IncidentVerifier(
            pack, TelemetryRepository(pool), repo, RunRepository(pool), VerifierConfig(plant_id=PLANT))
        assert await verifier.tick() == ["resolved"]
        with psycopg.connect(db_url) as conn:
            row = conn.execute("select status, closed_by, root_cause from incidents").fetchone()
            assert row[0] == "resolved" and row[1] == "verifier" and "92%" not in (row[2] or "")
            assert conn.execute("select status from signal_flags").fetchone()[0] == "resolved"
        assert await verifier.tick() == ["already-closed"]
    finally:
        await pool.close()


def test_recovery_evaluator_requires_sustained_partial_recovery():
    nominals = {"FIT-301": 2000, "PIT-301": 16, "PIT-302": 180, "JI-301": 9, "AIT-301": 15}
    recovered = {"FIT-301": [1850] * 10, "PIT-301": [15.8] * 10, "PIT-302": [178] * 10,
                 "JI-301": [8.5] * 10, "AIT-301": [15.6] * 10}
    out = evaluate_recovery(nominals=nominals, flag_current={"FIT-301": 1500},
                            series=recovered, abnormal_states=[])
    assert out["status"] == "passed" and out["fit_recovery_pct"] == 92.5
    assert evaluate_recovery(nominals=nominals, flag_current={}, series={"FIT-301": [1]},
                             abnormal_states=[])["status"] == "pending"


def test_normalize_clip_downsamples_with_ffmpeg(tmp_path):
    import shutil
    import subprocess
    from app.evidence.valve import normalize_clip
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    source = tmp_path / "in.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc=duration=2:size=1280x720:rate=60", "-pix_fmt", "yuv420p", str(source)], check=True)
    data, name, mime, fps = normalize_clip(source.read_bytes(), "in.mp4", "video/mp4", 60.0)
    assert (name, mime, fps) == ("clip.mp4", "video/mp4", 10.0)
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                            "stream=height,r_frame_rate", "-of", "csv=p=0", "-"], input=data,
                           capture_output=True).stdout.decode().strip()
    assert probe == "540,10/1"


def test_normalize_clip_passes_through_without_ffmpeg(monkeypatch):
    from app.evidence import valve
    monkeypatch.setattr(valve.shutil, "which", lambda _: None)
    assert valve.normalize_clip(b"raw", "a.mov", "video/quicktime", 30.0) == (b"raw", "a.mov", "video/quicktime", 30.0)


async def test_backwash_proposal_is_gated_on_the_bank_differential(db_url):
    from app.investigator.tools import ToolExecutor
    from app.repositories.runs import RunRepository
    from app.repositories.telemetry import TelemetryRepository
    pool, pack, incident_id = await seed_incident(db_url)
    try:
        repo = InvestigationRepository(pool)
        await repo.upsert_hypothesis(incident_id, "H1", "Cartridge bank restriction", "supported", ["x"], [])
        ex = ToolExecutor(pack, TelemetryRepository(pool), repo, RunRepository(pool),
                          incident_id=incident_id, plant_id="waterplant")
        args = {"asset_id": "V-113", "action": "backwash", "rationale": "restricted bank", "sop_id": "SOP-MF-003"}

        no_gauges = await ex.execute("propose_action", args)
        assert "PI-201 and PI-202" in no_gauges["error"]

        task = await repo.create_field_task(incident_id, kind="gauge_photo", asset_ids=["CB-1F", "CB-1B"],
                                            tags=["PI-201", "PI-202"], instruction="read both")
        await repo.complete_field_task(task["id"], {"readings": {"PI-201": 24.0, "PI-202": 16.0}})
        normal = await ex.execute("propose_action", args)
        assert "below the 12.0 psi restriction limit" in normal["error"] and normal["differential"]["dp_psi"] == 8.0

        other = await repo.create_field_task(incident_id, kind="gauge_photo", asset_ids=["CB-1F", "CB-1B"],
                                             tags=["PI-201", "PI-202"], instruction="read both again")
        await repo.complete_field_task(other["id"], {"readings": {"PI-201": 32.0, "PI-202": 15.0}})
        allowed = await ex.execute("propose_action", args)
        assert allowed["action_proposed"]["status"] == "pending"
    finally:
        await pool.close()


async def test_two_gauge_photos_complete_the_task_and_record_the_differential(db_url, monkeypatch, tmp_path):
    import app.investigator.__main__ as investigator_main
    from app.evidence.gauge import GaugePipeline, GaugeReading

    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(investigator_main, "meta_key", lambda: "test-key")
    values = {"PI-201": ("read", 32.0), "PI-202": ("unreadable", None)}

    async def fake_read_photo(self, image_bytes, inst):
        status, value = values[inst.tag]
        return GaugeReading(tag=inst.tag, status=status, value=value, mask_applied=True)

    monkeypatch.setattr(GaugePipeline, "read_photo", fake_read_photo)
    pool, pack, incident_id = await seed_incident(db_url)
    try:
        repo = InvestigationRepository(pool)
        task = await repo.create_field_task(incident_id, kind="gauge_photo", asset_ids=["CB-1F", "CB-1B"],
                                            tags=["PI-201", "PI-202"], instruction="Photograph inlet and outlet")
        photo = base64.b64encode(b"x" * 300).decode()
        app = create_app(pool, pack)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            url = f"/v1/incidents/{incident_id}/tasks/{task['id']}/photo"
            wrong = await client.post(url, json={"photos": {"PI-301": photo}})
            assert wrong.status_code == 422

            first = (await client.post(url, json={"photos": {"PI-201": photo, "PI-202": photo}})).json()
            assert first["completed"] is False and first["missing"] == ["PI-202"] and first["accepted"] == {"PI-201": 32.0}

            values["PI-202"] = ("read", 15.0)
            second = (await client.post(url, json={"photos": {"PI-202": photo}})).json()
            assert second["completed"] is True and second["accepted"] == {"PI-201": 32.0, "PI-202": 15.0}
            assert second["differential"]["dp_psi"] == 17.0 and second["differential"]["restricted"] is True

            detail = (await client.get(f"/v1/incidents/{incident_id}")).json()
            done = next(t for t in detail["field_tasks"] if t["id"] == str(task["id"]))
            assert done["status"] == "completed" and done["result"]["readings"] == {"PI-201": 32.0, "PI-202": 15.0}
            assert any("differential" in e["content"].lower() for e in detail["trace"])
    finally:
        await pool.close()


def test_only_real_trips_and_faults_are_abnormal_states():
    healthy = ["RUNNING", "STOPPED", "LEVEL_OK", "BELOW_HIGH", "OK", "NONE", "FLUSH"]
    abnormal = ["LOW_LEVEL", "HIGH_LEVEL", "LOW_PRESSURE_TRIP", "HIGH_PRESSURE_TRIP", "FAULT",
                "LOW_SUCTION_PRESSURE", "HIGH_DISCHARGE_PRESSURE", "RAW_TANK_LOW", "PURE_TANK_HIGH"]
    assert not any(is_abnormal_state(label) for label in healthy)
    assert all(is_abnormal_state(label) for label in abnormal)

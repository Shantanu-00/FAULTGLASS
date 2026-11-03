import base64
import datetime as dt
import json

import httpx
import psycopg
import pytest

from app.api.main import create_app
from app.db import create_pool
from app.evidence.lever import FrameAngle, LeverTrack
from app.evidence.valve import evaluate_lever_track
from app.evidence.voice import WonderObservationAnalyzer, compare_readings
from app.investigator.wonder import WonderReply
from app.investigator.worker import Investigator, InvestigatorConfig
from app.plant import load_pack
from app.repositories.investigation import InvestigationRepository
from app.repositories.runs import RunRepository
from app.repositories.telemetry import Reading, TelemetryRepository
from app.verifier.worker import IncidentVerifier, VerifierConfig, evaluate_recovery

from conftest import PACK_DIR
from test_investigator import PLANT, ScriptedWonder, call, investigator_for, message, seed_incident


def test_compare_readings_agree_disagree_partial():
    assert compare_readings({"PI-203": 23.0}, {"PI-203": 22.0})["status"] == "AGREE"
    assert compare_readings({"PI-203": 10.0}, {"PI-203": 22.0})["status"] == "DISAGREE"
    assert compare_readings({"PI-203": 22.0}, {"PI-203": 22.0, "PI-207": 6.0})["status"] == "PARTIAL"
    assert compare_readings({"PI-203": 22.0}, {})["status"] == "AWAITING_PHOTO"


async def test_wonder_analyzer_extracts_and_compares():
    wonder = ScriptedWonder([[message('{"readings":{"PI-203":22,"PI-207":6},"observation":"Line 3 back gauge is low","concerns":[]}')]])
    out = await WonderObservationAnalyzer(wonder).analyze(
        "PI-203 बावीस, PI-207 सहा", {"PI-203": 22.0, "PI-207": 5.0}, ["PI-203", "PI-207"])
    assert out["structured"]["readings"] == {"PI-203": 22.0, "PI-207": 6.0}
    assert out["comparison"]["status"] == "AGREE"


def track(stages):
    angles = {"OPEN": 0, "MID": 45, "CLOSED": 90, "BETWEEN": 25, "UNCERTAIN": None}
    return LeverTrack(frames=[FrameAngle(i, angles[s], s, 1.0) for i, s in enumerate(stages)])


def test_valve_policy_pass_hold_and_skip():
    passed = evaluate_lever_track(track(["OPEN", "OPEN", "MID", "MID", "MID", "CLOSED"]), fps=1)
    assert passed.status == "passed" and passed.mid_hold_s == 3
    assert evaluate_lever_track(track(["OPEN", "CLOSED"]), fps=30).status == "violated"
    short = evaluate_lever_track(track(["OPEN", "MID", "CLOSED"]), fps=10)
    assert short.status == "violated" and "held" in short.reasons[0]
    assert evaluate_lever_track(LeverTrack(frames=[]), fps=30).status == "uncertain"


async def test_proposal_approval_video_trigger_and_resume(db_url, monkeypatch, tmp_path):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    pool, pack, incident_id = await seed_incident(db_url)
    try:
        repo = InvestigationRepository(pool)
        await repo.upsert_hypothesis(incident_id, "H3", "Line 3 cartridge restriction", "supported", ["PI-207 low"], [])
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
                        "status": "passed", "reasons": ["staged"], "stages_seen": ["OPEN", "MID", "CLOSED"],
                        "mid_hold_s": 2.5, "measured_ratio": 1.0},
                    "track": {"frames": [], "stages_seen": ["OPEN", "MID", "CLOSED"],
                              "staged_sequence_ok": True}}
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
            tags=["PI-203", "PI-207"], instruction="Photograph line 3 gauges")
        await repo.complete_field_task(task["id"], {"readings": {"PI-203": 22.0, "PI-207": 6.0}})

        class FakeVoice:
            def __init__(self, key): pass
            async def transcribe_wav(self, data, **kwargs):
                from app.evidence.voice import Transcript
                return Transcript(text="PI-203 बावीस आणि PI-207 सहा", session_id="s1", model="muse-voice-transcribe-1.0")
            async def aclose(self): pass

        class FakeWonder:
            def __init__(self, key): pass
            async def create(self, items, tools, *, reasoning_effort="medium"):
                return WonderReply(output=[message('{"readings":{"PI-203":22,"PI-207":6},"observation":"Line 3 outlet low","concerns":[]}')])
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
            assert detail["voice_observations"][0]["transcript"].startswith("PI-203")
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

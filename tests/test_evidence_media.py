import hashlib
import base64
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI

from app.api.console_routes import router
from app.api.evidence_media import media_record, public_task, safe_media_path


def stored(path, kind="image", label="PI-201 photo"):
    return media_record(path=str(path), sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                        kind=kind, mime_type="image/jpeg" if kind == "image" else "audio/wav", label=label)


def test_media_metadata_supports_partial_legacy_and_missing_files_without_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    photo = tmp_path / "gauge.jpg"
    photo.write_bytes(b"actual photo")
    record = stored(photo)
    task = {"id": uuid4(), "status": "pending", "created_at": "2026-11-03T12:00:00Z",
            "result": {"_media": [record], "accepted": {"PI-201": 24},
                       "photos": {"PI-201": {"path": str(photo), "sha256": record["sha256"]}},
                       "video_path": str(tmp_path / "missing.mp4")}}
    out = public_task(task, "incident-1", [])
    assert out["result"] == {"accepted": {"PI-201": 24}}
    assert len(out["media"]) == 2  # duplicates in old and new storage are merged
    assert out["media"][0]["available"] is True
    assert out["media"][1]["available"] is False
    assert out["media"][1]["url"] is None
    assert str(tmp_path) not in str(out)
    assert out["media"][0]["url"].startswith(f"/v1/incidents/incident-1/tasks/{task['id']}/media/")


def test_media_rejects_outside_paths_symlinks_and_overwritten_legacy_uploads(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setenv("UPLOAD_DIR", str(uploads))
    outside = tmp_path / "secret.txt"
    outside.write_bytes(b"private")
    link = uploads / "linked.jpg"
    link.symlink_to(outside)
    assert safe_media_path(str(outside)) is None
    assert safe_media_path(str(link)) is None
    photo = uploads / "retry.jpg"
    photo.write_bytes(b"first attempt")
    record = stored(photo)
    photo.write_bytes(b"replacement attempt")
    assert safe_media_path(str(photo), record["sha256"]) is None


class FakeInvestigation:
    def __init__(self, tasks, voices=None):
        self.tasks = tasks
        self.voices = voices or []

    async def incident(self, incident_id):
        return {"incident_id": incident_id} if incident_id == "incident-1" else None

    async def field_tasks(self, incident_id):
        return self.tasks if incident_id == "incident-1" else []

    async def voice_observations(self, incident_id):
        return self.voices


async def test_only_task_recorded_files_are_served_with_range_support(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    photo = tmp_path / "gauge.jpg"
    photo.write_bytes(b"0123456789")
    unrelated = tmp_path / "unrelated.jpg"
    unrelated.write_bytes(b"not this incident")
    record = stored(photo)
    task_id = uuid4()
    app = FastAPI()
    app.include_router(router)
    app.state.investigation = FakeInvestigation([{"id": task_id, "result": {"_media": [record]}}])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        url = f"/v1/incidents/incident-1/tasks/{task_id}/media/{record['id']}"
        response = await client.get(url)
        assert response.status_code == 200
        assert response.content == b"0123456789"
        assert response.headers["content-type"] == "image/jpeg"
        assert response.headers["x-content-type-options"] == "nosniff"
        partial = await client.get(url, headers={"Range": "bytes=2-4"})
        assert partial.status_code == 206
        assert partial.content == b"234"
        assert (await client.get(url.replace("incident-1", "incident-2"))).status_code == 404
        assert (await client.get(url.replace(str(task_id), str(uuid4())))).status_code == 404
        assert (await client.get(url.replace(record["id"], stored(unrelated)["id"]))).status_code == 404


@pytest.mark.parametrize("kind,mime", [("video", "text/html"), ("image", "image/svg+xml"),
                                      ("audio", "application/javascript"), ("image", "video/mp4")])
async def test_unanalysed_upload_cannot_be_served_as_active_content(tmp_path, monkeypatch, kind, mime):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    upload = tmp_path / "unanalysed.bin"
    upload.write_bytes(b"<html><script>alert(1)</script></html>")
    record = stored(upload, kind=kind)
    record["mime_type"] = mime
    task = {"id": uuid4(), "status": "pending", "result": {"_media": [record]}}
    public = public_task(task, "incident-1", [])
    assert public["media"][0]["available"] is False
    assert public["media"][0]["url"] is None
    app = FastAPI()
    app.include_router(router)
    app.state.investigation = FakeInvestigation([task])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(f"/v1/incidents/incident-1/tasks/{task['id']}/media/{record['id']}")
        assert response.status_code == 404
        assert response.headers["content-type"] != "text/html"


async def test_media_registry_survives_partial_and_completed_result_updates(db_url, tmp_path):
    from app.repositories.investigation import InvestigationRepository
    from test_investigator import seed_incident

    # Use the repository directly: no model requests or live simulator changes.
    pool, pack, incident_id = await seed_incident(db_url)
    try:
        repo = InvestigationRepository(pool)
        task = await repo.create_field_task(incident_id, kind="gauge_photo", asset_ids=[], tags=["PI-201"], instruction="Read gauge")
        await repo.append_task_media(task["id"], [{"id": "saved", "path": "uploads/test.jpg", "kind": "image"}])
        await repo.save_task_progress(task["id"], {"accepted": {"PI-201": 24}})
        partial = (await repo.field_tasks(incident_id))[0]
        assert partial["result"]["_media"][0]["id"] == "saved"
        await repo.complete_field_task(task["id"], {"readings": {"PI-201": 24}, "source": "gauge_photo"})
        await repo.append_task_media(task["id"], [{"id": "voice", "path": "uploads/test.wav", "kind": "audio"}])
        completed = (await repo.field_tasks(incident_id))[0]
        assert completed["status"] == "completed"
        assert [item["id"] for item in completed["result"]["_media"]] == ["saved", "voice"]
    finally:
        await pool.close()


@pytest.mark.parametrize("failed", [False, True])
async def test_unsuccessful_recording_remains_visible_on_pending_task(db_url, tmp_path, monkeypatch, failed):
    from app.api.main import create_app
    from app.repositories.investigation import InvestigationRepository
    from test_investigator import seed_incident
    import app.investigator.__main__ as investigator_main

    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(investigator_main, "meta_key", lambda: "test-key")

    async def fake_analysis(*args, **kwargs):
        if failed:
            raise RuntimeError("test analysis failure")
        return {"file_id": "test", "track": {}, "policy": {"status": "uncertain", "reasons": ["Lever not visible"],
                    "movements": 0, "segments": [], "hold_s": None}}

    monkeypatch.setattr("app.evidence.valve.analyze_valve_clip", fake_analysis)
    pool, pack, incident_id = await seed_incident(db_url)
    try:
        repo = InvestigationRepository(pool)
        task = await repo.create_field_task(incident_id, kind="valve_action", asset_ids=["V-113"], tags=[], instruction="Record staged movement")
        app = create_app(pool, pack)
        clip = b"isolated test recording" * 12
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(f"/v1/incidents/{incident_id}/tasks/{task['id']}/video", json={
                "video_base64": base64.b64encode(clip).decode(), "mime_type": "video/mp4"})
            assert response.status_code == (502 if failed else 200)
            detail = (await client.get(f"/v1/incidents/{incident_id}")).json()
            pending = detail["field_tasks"][0]
            assert pending["status"] == "pending"
            assert pending["media"][0]["kind"] == "video"
            assert pending["media"][0]["available"] is True
            assert "video_path" not in str(pending)
            if failed:
                assert "analysis failed" in pending["result"]["error"]
            else:
                assert pending["result"]["policy"]["status"] == "uncertain"
            assert (await client.get(pending["media"][0]["url"])).content == clip
    finally:
        await pool.close()

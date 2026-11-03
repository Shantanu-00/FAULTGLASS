"""Expose only files recorded against an incident's task, never an upload directory."""
from __future__ import annotations

import datetime as dt
import hashlib
import os
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import quote


MEDIA_TYPES = {
    "image": {"image/jpeg", "image/png", "image/webp"},
    "audio": {"audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/webm"},
    "video": {"video/mp4", "video/webm", "video/quicktime"},
}


def media_mime_type(item: dict) -> str | None:
    """A retained upload may be unanalysed; never serve active document formats."""
    mime = str(item.get("mime_type", "")).split(";", 1)[0].strip().lower()
    return mime if mime in MEDIA_TYPES.get(item.get("kind"), set()) else None


def upload_root() -> Path:
    return Path(os.environ.get("UPLOAD_DIR", "uploads")).resolve()


@lru_cache(maxsize=128)
def _file_digest(path: str, modified: int, size: int) -> str:
    with open(path, "rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def safe_media_path(value: Any, digest: str | None = None) -> Path | None:
    if not isinstance(value, str) or not value:
        return None
    root = upload_root()
    path = Path(value).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        return None
    try:
        if not path.is_file():
            return None
        if digest:
            stat = path.stat()
            if _file_digest(str(path), stat.st_mtime_ns, stat.st_size) != digest:
                return None
    except OSError:
        return None
    return path


def media_record(*, path: str, sha256: str, kind: str, mime_type: str, label: str) -> dict:
    return {"id": hashlib.sha256(f"{path}:{sha256}".encode()).hexdigest()[:24],
            "path": path, "sha256": sha256, "kind": kind, "mime_type": mime_type,
            "label": label, "submitted_at": dt.datetime.now(dt.timezone.utc).isoformat()}


def task_media_records(task: dict, voices: list[dict] | None = None) -> list[dict]:
    result = task.get("result") or {}
    records = [dict(item) for item in result.get("_media", []) if isinstance(item, dict)]
    legacy_at = task.get("completed_at") or task.get("created_at")
    for tag, photo in (result.get("photos") or {}).items():
        if isinstance(photo, dict) and photo.get("path"):
            item = media_record(path=photo["path"], sha256=photo.get("sha256", ""),
                kind="image", mime_type="image/jpeg", label=f"{tag} · gauge photo")
            item["submitted_at"] = legacy_at
            records.append(item)
    if result.get("video_path"):
        path = result["video_path"]
        records.append(media_record(path=path, sha256=result.get("video_sha256", ""), kind="video",
            mime_type="video/quicktime" if Path(path).suffix.lower() == ".mov" else "video/mp4",
            label="Staged valve recording"))
        records[-1]["submitted_at"] = legacy_at
    for voice in voices or []:
        if str(voice.get("task_id")) == str(task["id"]) and voice.get("audio_path"):
            item = media_record(path=voice["audio_path"], sha256=voice.get("audio_sha256", ""),
                kind="audio", mime_type="audio/wav", label="Worker voice note")
            item["submitted_at"] = voice.get("created_at")
            records.append(item)
    unique: dict[str, dict] = {}
    for item in records:
        if item.get("kind") in {"image", "audio", "video"} and isinstance(item.get("path"), str):
            unique.setdefault(item["path"], item)
    return list(unique.values())


def public_media(incident_id: str, task_id: str, records: list[dict]) -> list[dict]:
    output = []
    for item in records:
        mime = media_mime_type(item)
        available = mime is not None and safe_media_path(item.get("path"), item.get("sha256")) is not None
        output.append({"id": item["id"], "kind": item["kind"],
            "mime_type": mime or "application/octet-stream", "label": item.get("label", "Submitted evidence"),
            "submitted_at": item.get("submitted_at"), "available": available,
            "url": (f"/v1/incidents/{quote(incident_id, safe='')}/tasks/{quote(str(task_id), safe='')}"
                    f"/media/{quote(item['id'], safe='')}") if available else None})
    return output


def public_task(task: dict, incident_id: str, voices: list[dict]) -> dict:
    records = task_media_records(task, voices)
    result = task.get("result")
    if isinstance(result, dict):
        result = {key: value for key, value in result.items()
                  if key not in {"_media", "photos", "video_path", "video_sha256", "video_file_id"}}
    return {**task, "result": result, "media": public_media(incident_id, str(task["id"]), records)}

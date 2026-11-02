from __future__ import annotations

import hashlib
import json
from pathlib import Path

import yaml
from pydantic import ValidationError

from .models import PlantPack
from .validate import validate_pack


class PackError(Exception):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("invalid plant pack:\n  " + "\n  ".join(problems))


def _read(path: Path):
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_pack(root: str | Path) -> PlantPack:
    """Load and fully validate a plant pack directory."""
    root = Path(root)
    try:
        layout_file = root / "layout.yaml"
        pack = PlantPack(
            manifest=_read(root / "manifest.yaml"),
            layout=_read(layout_file) if layout_file.exists() else None,
            assets=_read(root / "process" / "assets.yaml")["assets"],
            edges=_read(root / "process" / "edges.yaml")["edges"],
            routes=_read(root / "process" / "routes.yaml")["routes"],
            edge_nodes=_read(root / "sources.yaml")["edge_nodes"],
            sources=_read(root / "sources.yaml")["sources"],
            instruments=_read(root / "instruments.yaml")["instruments"],
        )
    except ValidationError as exc:
        raise PackError([f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()]) from exc
    problems = validate_pack(pack)
    if problems:
        raise PackError(problems)
    return pack


def content_hash(pack: PlantPack) -> str:
    """Stable digest of the pack content; identical content yields the same release."""
    canonical = json.dumps(pack.model_dump(mode="json", by_alias=True), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()

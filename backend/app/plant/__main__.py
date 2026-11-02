"""python -m app.plant validate|summary|rows|scene <pack dir>"""
from __future__ import annotations

import json
import sys
import uuid

from .briefing import summary
from .loader import PackError, content_hash, load_pack
from .rows import to_rows
from .scene import scene_model


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in {"validate", "summary", "rows", "scene"}:
        print(__doc__)
        return 2
    try:
        pack = load_pack(argv[2])
    except PackError as exc:
        print(exc)
        return 1
    if argv[1] == "validate":
        print(f"ok  {pack.manifest.id}  sha256:{content_hash(pack)[:12]}")
    elif argv[1] == "summary":
        print(summary(pack))
    elif argv[1] == "scene":
        print(json.dumps(scene_model(pack), indent=1))
    else:
        print(json.dumps(to_rows(pack, str(uuid.uuid4()), content_hash(pack)), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

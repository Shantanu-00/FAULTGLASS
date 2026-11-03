"""Render deploy/containers.template.json into deploy/containers.json.

Values come from the process environment, then from the repo-root .env. The key names
MODEL_API_KEY and BASETEN_API_KEY also accept the aliases META_MODEL_API and BASETEN_API.
Nothing is printed except the names of missing variables.

usage: python deploy/render.py IMAGE
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALIASES = {"MODEL_API_KEY": "META_MODEL_API", "BASETEN_API_KEY": "BASETEN_API"}
DEFAULTS = {
    "META_BASE_URL": "https://api.meta.ai/v1",
    "WONDER_MODEL": "muse-wonder-1.0",
    "BASETEN_BASE_URL": "https://inference.baseten.co/v1",
    "BASETEN_MODEL": "meta-models/muse-spark-open-1026",
    "SIM_BASELINE_S": "120",
    "EDGE_NODE_ID": "EDGE-01",
}
REQUIRED = ["DATABASE_URL", "CORS_ORIGINS", "MODEL_API_KEY", "BASETEN_API_KEY", "EDGE_API_KEY"]


def read_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip("'\"")
    return values


def main() -> int:
    image = sys.argv[1]
    dotenv = read_dotenv(ROOT / ".env")

    def lookup(name: str) -> str:
        for candidate in (name, ALIASES.get(name)):
            if candidate and (os.environ.get(candidate) or dotenv.get(candidate)):
                return os.environ.get(candidate) or dotenv[candidate]
        return DEFAULTS.get(name, "")

    values = {name: lookup(name) for name in set(re.findall(r"\$\{(\w+)\}", (ROOT / "deploy/containers.template.json").read_text()))}
    values["IMAGE"] = image
    missing = [name for name in REQUIRED if not values.get(name)]
    if missing:
        print("missing values: " + ", ".join(missing), file=sys.stderr)
        return 1

    def fill(node):
        if isinstance(node, dict):
            return {k: fill(v) for k, v in node.items()}
        if isinstance(node, list):
            return [fill(v) for v in node]
        if isinstance(node, str):
            return re.sub(r"\$\{(\w+)\}", lambda m: values[m.group(1)], node)
        return node

    template = json.loads((ROOT / "deploy/containers.template.json").read_text())
    out = ROOT / "deploy/containers.json"
    out.write_text(json.dumps(fill(template), indent=2) + "\n")
    out.chmod(0o600)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

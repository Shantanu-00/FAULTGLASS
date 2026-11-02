"""Smoke-test the Baseten Spark watcher path without a database.

Builds one healthy card and one production-decline card from synthetic numbers
matching docs/DEMO.md, asks Baseten Muse Spark Open to judge each, and prints
only the parsed verdicts (never the API key, never reasoning_content).

Usage:  cd backend && uv run python scripts/smoke_spark.py
Key:    BASETEN_API_KEY (or BASETEN_API) in the environment or repo-root .env
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.plant import load_pack  # noqa: E402
from app.watcher.__main__ import baseten_key, load_repo_env  # noqa: E402
from app.watcher.card import build_card  # noqa: E402
from app.watcher.spark import BasetenSparkClient, check_against_card, parse_verdict  # noqa: E402

PACK_DIR = Path(__file__).resolve().parents[2] / "plants" / "waterplant"
BASELINE = {"FIT-301": [2000.0, 1995.0, 2005.0, 1998.0], "PIT-301": [16.0, 16.1, 15.9, 16.0],
            "PIT-302": [180.0, 179.5, 180.5, 180.0], "JI-301": [9.0, 9.1, 8.9, 9.0], "AIT-301": [15.0, 15.2, 14.8, 15.0]}
HEALTHY = {"FIT-301": [2002.0, 1998.0], "PIT-301": [16.0, 16.1], "PIT-302": [180.0, 180.2],
           "JI-301": [9.0, 9.1], "AIT-301": [15.1, 15.0]}
DECLINE = {"FIT-301": [1505.0, 1495.0], "PIT-301": [15.1, 15.2], "PIT-302": [174.0, 174.5],
           "JI-301": [7.2, 7.3], "AIT-301": [17.0, 16.9]}
STATES = {"YS-101": "RUNNING", "YS-301": "RUNNING", "LSL-101": "LEVEL_OK", "FC-RO": "NONE"}


async def main() -> int:
    load_repo_env()
    pack = load_pack(PACK_DIR)
    client = BasetenSparkClient(baseten_key())
    try:
        for name, recent in (("healthy", HEALTHY), ("production decline", DECLINE)):
            card = build_card(pack.manifest.id, None, pack.instruments, BASELINE, recent, STATES)
            reply = await client.classify(card.text())
            verdict = parse_verdict(reply.content, card)
            validated, severity = check_against_card(verdict, card)
            print(f"{name}: verdict={verdict.verdict} validated={validated} severity={severity} "
                  f"latency_ms={reply.latency_ms} summary={verdict.summary!r}")
    finally:
        await client.aclose()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

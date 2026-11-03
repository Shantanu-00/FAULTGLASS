"""Smoke-test the Baseten Spark watcher path without a database.

Builds one healthy card and one production-decline card from synthetic numbers
matching docs/DEMO.md, asks Baseten Muse Spark Open to judge each, and prints
only the parsed verdicts (never the API key, never reasoning_content).

Usage:  cd backend && uv run python scripts/smoke_spark.py
        uv run python scripts/smoke_spark.py --repeat 3 --output ../docs/benchmarks/spark.json
Key:    BASETEN_API_KEY (or BASETEN_API) in the environment or repo-root .env
"""
from __future__ import annotations

import asyncio
import argparse
import json
import statistics
import sys
from datetime import datetime, timezone
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


async def main(repeat: int = 1, output: Path | None = None) -> int:
    load_repo_env()
    pack = load_pack(PACK_DIR)
    client = BasetenSparkClient(baseten_key())
    cases = (("healthy", HEALTHY), ("production decline", DECLINE))
    samples = []
    cards = {}
    started_at = datetime.now(timezone.utc).isoformat()
    try:
        for repetition in range(1, repeat + 1):
            for name, recent in cases:
                card = build_card(pack.manifest.id, None, pack.instruments, BASELINE, recent, STATES)
                cards[name] = card.text()
                reply = await client.classify(card.text())
                verdict = parse_verdict(reply.content, card)
                validated, severity = check_against_card(verdict, card)
                samples.append({"case": name, "repetition": repetition, "verdict": verdict.verdict,
                                "validated_tags": validated, "severity": severity,
                                "latency_ms": reply.latency_ms, "summary": verdict.summary})
                print(f"{name} [{repetition}/{repeat}]: verdict={verdict.verdict} "
                      f"validated={validated} severity={severity} "
                      f"latency_ms={reply.latency_ms} summary={verdict.summary!r}", flush=True)
    finally:
        await client.aclose()
    if output is not None:
        timings = [sample["latency_ms"] for sample in samples]
        report = {
            "started_at_utc": started_at,
            "completed_at_utc": datetime.now(timezone.utc).isoformat(),
            "provider": "Baseten", "model": client.model,
            "endpoint": "https://inference.baseten.co/v1/chat/completions",
            "reasoning_effort": "low", "max_tokens": 1024,
            "method": "Sequential requests through one httpx client; no retries or excluded warmup. "
                      "Client wall time from before POST to complete HTTP response; includes network, "
                      "provider processing and generation. Not time to first token or end-to-end detection latency.",
            "inputs": "Synthetic telemetry cards; no factory telemetry or database writes.",
            "cards": cards,
            "sample_count": len(samples),
            "latency_ms": {"min": min(timings), "median": statistics.median(timings),
                           "mean": round(statistics.mean(timings), 1), "max": max(timings)},
            "samples": samples,
        }
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f"Saved {len(samples)} requests to {output}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeat", type=int, default=1, help="Requests per case (default: 1)")
    parser.add_argument("--output", type=Path, help="Write a JSON timing report")
    args = parser.parse_args()
    if args.repeat < 1:
        parser.error("--repeat must be at least 1")
    raise SystemExit(asyncio.run(main(args.repeat, args.output)))

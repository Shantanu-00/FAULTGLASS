"""Exercise real client HTTP boundaries without contacting model providers."""
import asyncio
import datetime as dt
import io
import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest

from app.investigator.wonder import WonderClient, WonderError
from app import observability
from app.observability import model_log_context
from app.watcher.spark import BasetenSparkClient, SparkError
from app.watcher.card import Card, SignalCard
from app.watcher.worker import SparkWatcher, WatcherConfig


def events(caplog, schema="faultglass.model_call.v1"):
    return [record for row in caplog.records if row.name == "faultglass.telemetry"
            and (record := json.loads(row.getMessage()))["schema"] == schema]


@pytest.fixture(autouse=True)
def capture_events(caplog):
    caplog.set_level(logging.INFO, logger="faultglass.telemetry")


async def test_wonder_logs_correlated_metadata_without_payloads(caplog):
    secret = "PRIVATE_PROMPT_AND_REASONING"
    output = [
        {"type": "reasoning", "encrypted_content": secret},
        {"type": "function_call", "name": "get_latest_telemetry", "arguments": secret},
        {"type": "function_call", "name": secret, "arguments": secret},
    ]

    def respond(request):
        assert request.headers["authorization"] == "Bearer PRIVATE_API_KEY"
        assert json.loads(request.content)["input"][0]["content"] == secret
        return httpx.Response(200, headers={"x-request-id": "meta-request-123"}, json={
            "output": output,
            "usage": {"input_tokens": 30, "output_tokens": 7, "total_tokens": 37,
                      "unexpected_provider_field": secret, "reasoning_content": secret},
        })

    client = WonderClient("PRIVATE_API_KEY", transport=httpx.MockTransport(respond))
    try:
        with model_log_context(run_id="run-123", incident_id="INC-123", step=2, prompt=secret):
            reply = await client.create([{"role": "user", "content": secret}], [{"name": "get_latest_telemetry"}])
    finally:
        await client.aclose()
    assert reply.output == output  # encrypted replay remains intact
    start, done = events(caplog)
    assert [start["event"], done["event"]] == ["model_call.started", "model_call.succeeded"]
    assert start["call_id"] == done["call_id"]
    assert done["provider"] == "meta"
    assert done["run_id"] == "run-123" and done["incident_id"] == "INC-123" and done["step"] == 2
    assert done["http_status"] == 200 and done["provider_request_id"] == "meta-request-123"
    assert done["usage"] == {"input_tokens": 30, "output_tokens": 7, "total_tokens": 37}
    assert done["tool_names"] == ["get_latest_telemetry"] and done["tool_call_count"] == 2
    assert done["duration_ms"] >= 0
    assert secret not in json.dumps(events(caplog))
    assert "PRIVATE_API_KEY" not in json.dumps(events(caplog))


async def test_spark_logs_usage_but_never_card_content_or_reasoning(caplog):
    secret = "PRIVATE_CARD_AND_REASONING"
    client = BasetenSparkClient("PRIVATE_API_KEY", transport=httpx.MockTransport(lambda request: httpx.Response(
        200, headers={"x-baseten-request-id": "baseten-request-123"}, json={
            "choices": [{"message": {"content": "NORMAL\nNo drift.\nTAGS: none", "reasoning_content": secret}}],
            "usage": {"prompt_tokens": 50, "completion_tokens": 9, "total_tokens": 59, "private": secret},
        })))
    try:
        reply = await client.classify(secret)
    finally:
        await client.aclose()
    assert reply.content.startswith("NORMAL")
    start, done = events(caplog)
    assert start["call_id"] == done["call_id"]
    assert done["event"] == "model_call.succeeded" and done["provider"] == "baseten"
    assert done["provider_request_id"] == "baseten-request-123"
    assert done["usage"] == {"prompt_tokens": 50, "completion_tokens": 9, "total_tokens": 59}
    assert secret not in json.dumps(events(caplog)) and "PRIVATE_API_KEY" not in json.dumps(events(caplog))


@pytest.mark.parametrize("client_type,error_type", [(WonderClient, WonderError), (BasetenSparkClient, SparkError)])
@pytest.mark.parametrize("failure", ["http", "timeout", "malformed"])
async def test_client_failures_have_one_terminal_event_without_error_payload(caplog, client_type, error_type, failure):
    secret = "PRIVATE_ERROR_BODY"

    def respond(request):
        if failure == "timeout":
            raise httpx.ReadTimeout(secret, request=request)
        if failure == "malformed":
            return httpx.Response(200, content=secret)
        return httpx.Response(429, headers={"x-request-id": "failure-123"}, text=secret)

    client = client_type("PRIVATE_API_KEY", transport=httpx.MockTransport(respond))
    try:
        with pytest.raises(error_type):
            if isinstance(client, WonderClient):
                await client.create([{"role": "user", "content": secret}], [])
            else:
                await client.classify(secret)
    finally:
        await client.aclose()
    start, failed = events(caplog)
    assert start["event"] == "model_call.started" and failed["event"] == "model_call.failed"
    assert start["call_id"] == failed["call_id"] and failed["duration_ms"] >= 0
    assert failed["error_type"]
    if failure == "http":
        assert failed["http_status"] == 429 and failed["provider_request_id"] == "failure-123"
    elif failure == "timeout":
        assert failed["error_type"] == "ReadTimeout" and "http_status" not in failed
    assert secret not in json.dumps(events(caplog)) and "PRIVATE_API_KEY" not in json.dumps(events(caplog))


async def test_concurrent_call_contexts_are_isolated_and_reset(caplog):
    async def respond(request):
        await asyncio.sleep(0)
        return httpx.Response(200, json={"output": []})

    client = WonderClient("key", transport=httpx.MockTransport(respond))

    async def invoke(incident):
        with model_log_context(incident_id=incident):
            await client.create([], [])

    try:
        await asyncio.gather(invoke("INC-A"), invoke("INC-B"))
        await client.create([], [])
    finally:
        await client.aclose()
    rows = events(caplog)
    assert len({row["call_id"] for row in rows}) == 3
    for call_id in {row["call_id"] for row in rows}:
        pair = [row for row in rows if row["call_id"] == call_id]
        assert len(pair) == 2 and pair[0].get("incident_id") == pair[1].get("incident_id")
    assert "incident_id" not in rows[-1] and "incident_id" not in rows[-2]


async def test_watcher_explains_skip_transitions_without_repeating_every_tick(caplog):
    run_id = uuid4()
    learning = SimpleNamespace(id=run_id, status="learning", baseline_ready_at=None)
    running = SimpleNamespace(id=run_id, status="running", baseline_ready_at="ready")
    runs = SimpleNamespace(active=AsyncMock(side_effect=[None, None, learning, learning, running, running]))
    spark = SimpleNamespace(classify=AsyncMock())
    watcher = SparkWatcher(runs, None, None, spark, [], WatcherConfig(plant_id="waterplant"))
    watcher._build_card = AsyncMock(return_value=SimpleNamespace(signals=[SimpleNamespace(current=None)]))
    assert [await watcher.tick() for _ in range(6)] == [
        "no-run", "no-run", "skipped-learning", "skipped-learning", "no-data", "no-data"]
    rows = events(caplog, "faultglass.watcher_state.v1")
    assert [row["state"] for row in rows] == ["no-run", "skipped-learning", "no-data"]
    assert rows[1]["run_id"] == str(run_id)
    spark.classify.assert_not_awaited()


def test_assessment_contains_only_finite_numeric_sensor_values_and_validated_tags(caplog):
    with model_log_context(purpose="telemetry_classification"):
        observability.watcher_assessment(
            plant_id="waterplant", run_id="run-123", incident_id="INC-123", verdict="FLAG", outcome="flagged",
            validated_tags=["FIT-301", "PSL-301", "PRIVATE UNKNOWN TAG"], measurements={
                "FIT-301": {"current": 1505.12345, "baseline": 2000.0, "summary": "PRIVATE_SUMMARY"},
                "PIT-301": {"current": float("nan"), "baseline": 16.0},
                "JI-301": {"current": float("inf"), "baseline": True},
            })
    row, = events(caplog, "faultglass.watcher_assessment.v1")
    assert row["measurements"] == {"FIT-301": {"current": 1505.123, "baseline": 2000.0},
                                   "PIT-301": {"baseline": 16.0}}
    assert row["validated_tags"] == ["FIT-301", "PSL-301"]  # discrete tags need no numeric measurement
    assert row["verdict"] == "FLAG" and row["outcome"] == "flagged"
    assert row["run_id"] == "run-123" and row["incident_id"] == "INC-123"
    assert "PRIVATE_" not in json.dumps(row)


def test_configured_model_events_are_independent_json_lines_on_stdout(monkeypatch):
    buffer = io.StringIO()
    logger = logging.getLogger("faultglass.telemetry")
    with monkeypatch.context() as patch:
        patch.setattr(observability.sys, "stdout", buffer)
        patch.setattr(observability, "_service", "backend")
        patch.setattr(logger, "handlers", [])
        patch.setattr(logger, "propagate", True)
        observability.configure_event_logging("watcher")
        with observability.ModelCall(provider="baseten", model="spark", operation="chat.completions"):
            pass
    lines = [json.loads(line) for line in buffer.getvalue().splitlines()]
    assert [row["event"] for row in lines] == ["model_call.started", "model_call.succeeded"]
    assert all(row["service"] == "watcher" for row in lines)


@pytest.mark.parametrize("outcome,existing_incident", [
    ("flagged", None), ("duplicate", None), ("duplicate", "INC-EXISTING"), ("rejected", None),
])
async def test_real_client_assessment_links_only_confirmed_incidents(caplog, outcome, existing_incident):
    run = SimpleNamespace(id=uuid4(), status="running", baseline_ready_at="ready",
                          started_at=dt.datetime(2026, 11, 5, tzinfo=dt.timezone.utc))
    drifting = outcome != "rejected"
    signal = SignalCard("FIT-301", "Permeate flow", "L/h", 1500 if drifting else 1999,
                        2000, 20, -500 if drifting else -1, -25 if drifting else -0.05,
                        -25 if drifting else -0.05)
    card = Card("waterplant", str(run.id), [signal])
    flags = SimpleNamespace(
        open_flag_for=AsyncMock(return_value={"incident_id": existing_incident} if outcome == "duplicate" else None),
        ensure_incident=AsyncMock(), create=AsyncMock(return_value={"id": "flag-123"}), add_trace=AsyncMock(),
    )
    client = BasetenSparkClient("key", transport=httpx.MockTransport(lambda request: httpx.Response(200, json={
        "choices": [{"message": {"content": "FLAG\nPRIVATE_MODEL_SUMMARY\nTAGS: FIT-301"}}],
    })))
    watcher = SparkWatcher(SimpleNamespace(active=AsyncMock(return_value=run)), None, flags, client,
                           [SimpleNamespace(tag="FIT-301")], WatcherConfig(plant_id="waterplant"))
    watcher._build_card = AsyncMock(return_value=card)
    try:
        assert await watcher.tick() == outcome
    finally:
        await client.aclose()
    start, completed = events(caplog)
    assessment, = events(caplog, "faultglass.watcher_assessment.v1")
    assert start["run_id"] == completed["run_id"] == assessment["run_id"] == str(run.id)
    assert assessment["outcome"] == outcome and assessment["verdict"] == "FLAG"
    assert assessment["measurements"]["FIT-301"]["current"] == signal.current
    assert "PRIVATE_MODEL_SUMMARY" not in json.dumps(assessment)
    if outcome == "flagged":
        assert assessment["incident_id"] == flags.ensure_incident.call_args.args[1]
    elif existing_incident:
        assert assessment["incident_id"] == existing_incident
    else:
        assert "incident_id" not in assessment

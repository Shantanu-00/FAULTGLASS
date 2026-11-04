"""Safe, correlated model-call metadata for container logs and CloudWatch.

Only explicitly selected metadata is emitted. Prompts, model output, request
bodies, credentials and reasoning never enter these records.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import math
import re
import sys
import time
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator
from uuid import uuid4

log = logging.getLogger("faultglass.telemetry")
_context: ContextVar[dict[str, Any]] = ContextVar("model_log_context", default={})
_service = "backend"
_CONTEXT_FIELDS = {"plant_id", "run_id", "incident_id", "task_id", "purpose", "step"}
_IDENTIFIER = re.compile(r"[A-Za-z0-9_.:/@+\-]{1,160}\Z")
_TOKEN_FIELDS = {"input_tokens", "output_tokens", "total_tokens", "prompt_tokens", "completion_tokens"}


def _identifier(value: Any) -> str | None:
    value = str(value) if value is not None else ""
    return value if _IDENTIFIER.fullmatch(value) else None


def configure_event_logging(service: str) -> None:
    """Keep machine-readable event lines on stdout, separate from worker text."""
    global _service
    _service = _identifier(service) or "backend"
    if not any(getattr(handler, "faultglass_events", False) for handler in log.handlers):
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        handler.faultglass_events = True
        log.addHandler(handler)
    log.setLevel(logging.INFO)
    log.propagate = False


@contextmanager
def model_log_context(**fields: Any) -> Iterator[None]:
    """Add bounded correlation identifiers without changing client protocols."""
    context = dict(_context.get())
    for key, value in fields.items():
        if key not in _CONTEXT_FIELDS:
            continue
        if key == "step":
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                context[key] = value
        elif (safe := _identifier(value)) is not None:
            context[key] = safe
    token = _context.set(context)
    try:
        yield
    finally:
        _context.reset(token)


def _emit(schema: str, event: str, fields: dict[str, Any]) -> None:
    record = {
        "schema": schema,
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds"),
        "event": event,
        "service": _service,
        **_context.get(),
        **fields,
    }
    log.info(json.dumps(record, separators=(",", ":"), ensure_ascii=True))


def watcher_state(state: str, *, plant_id: str, run_id: Any = None) -> None:
    with model_log_context(plant_id=plant_id, run_id=run_id):
        _emit("faultglass.watcher_state.v1", "watcher.state_changed", {"state": state})


def watcher_assessment(*, plant_id: str, run_id: Any, incident_id: str | None,
                       verdict: str, outcome: str, validated_tags: list[str],
                       measurements: dict[str, dict[str, Any]]) -> None:
    """Show the numeric evidence behind a real Spark verdict, never its prose."""
    if verdict not in {"NORMAL", "WATCH", "FLAG"} or outcome not in {
        "normal", "rejected", "duplicate", "flagged", "watched",
    }:
        return
    values = {}
    for tag, signal in list(measurements.items())[:16]:
        if not _identifier(tag):
            continue
        numeric = {key: round(value, 3) for key, value in signal.items()
                   if key in {"current", "baseline"} and isinstance(value, (int, float))
                   and not isinstance(value, bool) and math.isfinite(value) and abs(value) <= 1e12}
        if numeric:
            values[tag] = numeric
    fields = {"verdict": verdict, "outcome": outcome,
              "validated_tags": [tag for tag in validated_tags[:16] if _identifier(tag)],
              "measurements": values}
    with model_log_context(plant_id=plant_id, run_id=run_id, incident_id=incident_id):
        _emit("faultglass.watcher_assessment.v1", "watcher.assessed", fields)


class ModelCall:
    """A start and one terminal event for each attempted provider request."""

    def __init__(self, *, provider: str, model: str, operation: str):
        self._fields: dict[str, Any] = {
            "call_id": uuid4().hex,
            "provider": _identifier(provider) or "unknown",
            "model": _identifier(model) or "unknown",
            "operation": _identifier(operation) or "unknown",
        }
        self._started = 0.0

    def __enter__(self) -> ModelCall:
        self._started = time.monotonic()
        _emit("faultglass.model_call.v1", "model_call.started", self._fields)
        return self

    def response(self, response: Any) -> None:
        self._fields["http_status"] = response.status_code
        for header in ("x-request-id", "request-id", "x-baseten-request-id"):
            request_id = _identifier(response.headers.get(header))
            if request_id:
                self._fields["provider_request_id"] = request_id
                break

    def result(self, *, usage: Any = None, output: Any = None, tools: Any = None) -> None:
        if isinstance(usage, dict):
            tokens = {key: value for key, value in usage.items()
                      if key in _TOKEN_FIELDS and isinstance(value, int)
                      and not isinstance(value, bool) and value >= 0}
            if tokens:
                self._fields["usage"] = tokens
        if isinstance(output, list):
            calls = [item for item in output if isinstance(item, dict) and item.get("type") == "function_call"]
            # Only names from the declared tools are allowed into logs; never arguments.
            declared = {tool.get("name") for tool in (tools or []) if isinstance(tool, dict)
                        and isinstance(tool.get("name"), str)}
            names = {item.get("name") for item in calls if isinstance(item.get("name"), str)
                     and item["name"] in declared and _identifier(item["name"])}
            self._fields["tool_call_count"] = len(calls)
            self._fields["tool_names"] = sorted(names)

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        fields = {**self._fields, "duration_ms": max(0, int((time.monotonic() - self._started) * 1000))}
        if exc is not None:
            # The exception message may contain URLs, provider payloads or secrets.
            cause = exc.__cause__ or exc
            fields["error_type"] = type(cause).__name__
        event = "model_call.failed" if exc is not None else "model_call.succeeded"
        _emit("faultglass.model_call.v1", event, fields)

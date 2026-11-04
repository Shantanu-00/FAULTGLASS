#!/usr/bin/env python3
"""CloudShell-friendly Lightsail -> CloudWatch demo collector (stdlib + AWS CLI).

Keep this process running during recording; Ctrl+C exits. No API keys or model
request payloads are read. See docs/MODEL_LOGGING.md for setup and limitations.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

IDENTIFIER = re.compile(r"[A-Za-z0-9_.:/@+\-]{1,160}\Z")
STRING_FIELDS = (
    "call_id", "provider", "model", "operation", "service", "plant_id", "run_id",
    "incident_id", "task_id", "purpose", "provider_request_id", "error_type", "state",
)
TOKEN_FIELDS = {"input_tokens", "output_tokens", "total_tokens", "prompt_tokens", "completion_tokens"}


class AwsError(RuntimeError):
    def __init__(self, code: str, operation: str):
        self.code = code
        super().__init__(f"AWS {operation} failed ({code}); check region, profile and IAM permissions.")


class Collector:
    def __init__(self, *, service="faultglass", region="eu-west-3",
                 group="/faultglass/model-calls", containers=("api", "watcher", "investigator"),
                 profile=None, retention=7):
        self.service, self.region, self.group = service, region, group
        self.containers, self.profile, self.retention = tuple(containers), profile, retention
        self.sent: set[str] = set()

    def aws(self, *args: str) -> dict:
        command = ["aws", *args, "--region", self.region, "--output", "json", "--no-cli-pager",
                   "--cli-connect-timeout", "5", "--cli-read-timeout", "15"]
        if self.profile:
            command += ["--profile", self.profile]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode:
            # Never echo raw CLI diagnostics, which may contain request data.
            match = re.search(r"\(([A-Za-z][A-Za-z0-9]+)\) when calling", result.stderr)
            code = match.group(1) if match else "AwsCommandFailed"
            if "could not be found" in result.stderr and "profile" in result.stderr:
                code = "ProfileNotFound"
            if "Unable to locate credentials" in result.stderr:
                code = "CredentialsUnavailable"
            raise AwsError(code, " ".join(args[:2]))
        return json.loads(result.stdout) if result.stdout.strip() else {}

    def initialize(self):
        created = False
        try:
            self.aws("logs", "create-log-group", "--log-group-name", self.group, "--log-group-class", "STANDARD")
            created = True
        except AwsError as exc:
            if exc.code != "ResourceAlreadyExistsException":
                raise
        groups = self.aws("logs", "describe-log-groups", "--log-group-name-prefix", self.group)
        found = [g for g in groups.get("logGroups", []) if g["logGroupName"] == self.group]
        if len(found) != 1 or found[0].get("logGroupClass", "STANDARD") != "STANDARD":
            raise RuntimeError("Live Tail requires an existing STANDARD log group.")
        if created:
            self.aws("logs", "put-retention-policy", "--log-group-name", self.group,
                     "--retention-in-days", str(self.retention))
        for container in self.containers:
            try:
                self.aws("logs", "create-log-stream", "--log-group-name", self.group,
                         "--log-stream-name", f"{self.service}/{container}")
            except AwsError as exc:
                if exc.code != "ResourceAlreadyExistsException":
                    raise

    def safe_event(self, message: str, container: str) -> dict | None:
        if not isinstance(message, str) or len(message) > 32768:
            return None
        try:
            record = json.loads(message)
            if not isinstance(record, dict):
                return None
            schema, event = record.get("schema"), record.get("event")
            is_call = schema == "faultglass.model_call.v1"
            is_state = schema == "faultglass.watcher_state.v1"
            is_assessment = schema == "faultglass.watcher_assessment.v1"
            if not (is_call or is_state or is_assessment):
                return None
            if is_call and (event not in {"model_call.started", "model_call.succeeded", "model_call.failed"}
                            or not re.fullmatch(r"[a-fA-F0-9]{32}", str(record.get("call_id", "")))
                            or any(not isinstance(record.get(k), str) or not IDENTIFIER.fullmatch(record[k])
                                   for k in ("provider", "model", "operation"))):
                return None
            if is_state and (event != "watcher.state_changed" or not IDENTIFIER.fullmatch(str(record.get("state", "")))):
                return None
            if is_assessment and (event != "watcher.assessed" or record.get("verdict") not in {"NORMAL", "WATCH", "FLAG"}
                                  or record.get("outcome") not in {"normal", "rejected", "duplicate", "flagged", "watched"}):
                return None
            timestamp = dt.datetime.fromisoformat(record["timestamp"].replace("Z", "+00:00"))
            if timestamp.tzinfo is None:
                return None
        except (ValueError, TypeError, KeyError, AttributeError):
            return None
        safe: dict[str, Any] = {"schema": schema, "event": event, "timestamp": timestamp.isoformat(),
                                "source_container": container, "lightsail_service": self.service}
        safe.update({key: record[key] for key in STRING_FIELDS
                     if isinstance(record.get(key), str) and IDENTIFIER.fullmatch(record[key])})
        safe.update({key: record[key] for key in ("step", "duration_ms", "http_status", "tool_call_count")
                     if type(record.get(key)) is int and record[key] >= 0})
        for key, limit in (("tool_names", 64), ("validated_tags", 16)):
            if isinstance(record.get(key), list):
                safe[key] = [v for v in record[key] if isinstance(v, str) and IDENTIFIER.fullmatch(v)][:limit]
        usage = record.get("usage")
        if isinstance(usage, dict):
            safe["usage"] = {k: v for k, v in usage.items() if k in TOKEN_FIELDS and type(v) is int and v >= 0}
        if is_assessment:
            safe.update(verdict=record["verdict"], outcome=record["outcome"])
            measurements = record.get("measurements")
            safe["measurements"] = {}
            if isinstance(measurements, dict):
                for tag, values in list(measurements.items())[:16]:
                    if not isinstance(tag, str) or not IDENTIFIER.fullmatch(tag) or not isinstance(values, dict):
                        continue
                    reading = {k: v for k, v in values.items() if k in {"current", "baseline"}
                               and type(v) in (int, float) and abs(v) <= 1e12 and math.isfinite(v)}
                    if reading:
                        safe["measurements"][tag] = reading
        text = json.dumps(safe, separators=(",", ":"), sort_keys=True)
        identity = f"{container}|{record['call_id']}|{event}" if is_call else f"{container}|{text}"
        return {"key": hashlib.sha256(identity.encode()).hexdigest(),
                "timestamp": int(timestamp.timestamp() * 1000), "message": text}

    def send_batch(self, events: list[dict], container: str) -> int:
        if not events:
            return 0
        payload = {"logGroupName": self.group, "logStreamName": f"{self.service}/{container}",
                   "logEvents": [{"timestamp": e["timestamp"], "message": e["message"]} for e in events]}
        with tempfile.TemporaryDirectory(prefix="faultglass-logs-") as temp:
            path = Path(temp) / "events.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = self.aws("logs", "put-log-events", "--cli-input-json", f"file://{path}")
        rejected = result.get("rejectedLogEventsInfo") or {}
        old_end = max(rejected.get("expiredLogEventEndIndex", -1), rejected.get("tooOldLogEventEndIndex", -1))
        new_start = rejected.get("tooNewLogEventStartIndex", len(events))
        accepted = 0
        for index, event in enumerate(events):
            if index <= old_end:  # terminally quarantine stale records for this session
                self.sent.add(event["key"])
            elif index < new_start:
                self.sent.add(event["key"])
                accepted += 1
        if old_end >= 0:
            print(f"Quarantined {old_end + 1} expired/too-old events; they were not forwarded. Check retention.", file=sys.stderr)
        if new_start < len(events):
            print("CloudWatch rejected future timestamps; only those events will retry. Check the clock.", file=sys.stderr)
        return accepted

    def poll(self, container: str, start_time: int) -> int:
        pending, tokens, token = {}, set(), None
        while True:
            args = ["lightsail", "get-container-log", "--service-name", self.service,
                    "--container-name", container, "--start-time", str(start_time)]
            if token:
                args += ["--page-token", token]
            page = self.aws(*args)
            for line in page.get("logEvents", []):
                event = self.safe_event(line.get("message"), container)
                if event and event["key"] not in self.sent:
                    pending[event["key"]] = event
            token = page.get("nextPageToken")
            if not token:
                break
            if token in tokens:
                raise RuntimeError("Repeated Lightsail page token; retrying source without acknowledging partial data.")
            tokens.add(token)
        count, batch, size = 0, [], 0
        for event in sorted(pending.values(), key=lambda e: (e["timestamp"], e["key"])):
            event_size = len(event["message"].encode()) + 26
            if batch and (size + event_size > 1_000_000 or len(batch) >= 10000):
                count += self.send_batch(batch, container)
                batch, size = [], 0
            batch.append(event)
            size += event_size
        return count + self.send_batch(batch, container)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", default="faultglass")
    parser.add_argument("--region", default="eu-west-3")
    parser.add_argument("--group", default="/faultglass/model-calls")
    parser.add_argument("--containers", nargs="+", default=["api", "watcher", "investigator"])
    parser.add_argument("--profile")
    parser.add_argument("--retention", type=int, choices=[1, 3, 5, 7, 14, 30, 60, 90], default=7)
    parser.add_argument("--poll-seconds", type=float, default=5)
    parser.add_argument("--lookback-minutes", type=float, default=10)
    parser.add_argument("--initialize", action="store_true")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.poll_seconds <= 60 or not 0 <= args.lookback_minutes <= 1440:
        parser.error("poll-seconds must be 1..60 and lookback-minutes 0..1440")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", args.service) or any(
            not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,62}", c) for c in args.containers):
        parser.error("invalid service or container name")
    collector = Collector(service=args.service, region=args.region, group=args.group,
                          containers=args.containers, profile=args.profile, retention=args.retention)
    fatal = {"ProfileNotFound", "CredentialsUnavailable", "AccessDeniedException", "AccessDenied",
             "ResourceNotFoundException", "InvalidInputException", "UnrecognizedClientException", "ExpiredTokenException"}
    try:
        if args.initialize:
            collector.initialize()
        start_time = int(time.time() - args.lookback_minutes * 60)  # fixed session cutoff
        print(f"Forwarding {args.service} to {args.group} in {args.region}; keep this CloudShell session running.", flush=True)
        while True:
            for container in args.containers:
                try:
                    count = collector.poll(container, start_time)
                    if count:
                        print(f"{container}: forwarded {count} real telemetry events", flush=True)
                except (AwsError, RuntimeError) as exc:
                    if args.once or isinstance(exc, AwsError) and exc.code in fatal:
                        raise
                    print(f"{container}: {exc} Retrying next poll.", flush=True)
            if args.once:
                return 0
            time.sleep(args.poll_seconds)
    except KeyboardInterrupt:
        print("\nForwarding stopped.", flush=True)
        return 0
    except (AwsError, RuntimeError, OSError) as exc:
        print(str(exc), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Offline tests: no AWS credentials, CLI commands or network requests are used."""
import datetime as dt
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("cloudwatch_forwarder", Path(__file__).parents[2] / "deploy" / "forward_model_logs.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def call(number=1):
    return json.dumps({"schema": "faultglass.model_call.v1", "event": "model_call.succeeded",
                       "timestamp": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=number)).isoformat(),
                       "call_id": f"{number:032x}", "provider": "meta", "model": "muse-wonder-1.0",
                       "operation": "responses", "duration_ms": 10, "prompt": "PRIVATE",
                       "usage": {"input_tokens": 5, "authorization": "PRIVATE"}})


class FakeCollector(MODULE.Collector):
    def __init__(self):
        super().__init__()
        self.mode, self.uploads, self.commands = "normal", [], []

    def aws(self, *args):
        self.commands.append(args)
        operation = args[1]
        if operation == "get-container-log":
            if "--page-token" in args:
                if self.mode == "fail-read":
                    raise MODULE.AwsError("ThrottlingException", operation)
                return {"logEvents": [{"message": call(1)}, {"message": call(2)}]}
            return {"logEvents": [{"message": call(1)}, {"message": "ordinary log"}], "nextPageToken": "two"}
        if operation == "put-log-events":
            if self.mode == "fail-upload":
                raise MODULE.AwsError("ThrottlingException", operation)
            payload = json.loads(Path(args[3][7:]).read_text())
            self.uploads.append(payload)
            if self.mode == "partial":
                return {"rejectedLogEventsInfo": {"tooOldLogEventEndIndex": 0, "tooNewLogEventStartIndex": 2}}
            return {}
        if operation == "create-log-group" and self.mode == "existing":
            raise MODULE.AwsError("ResourceAlreadyExistsException", operation)
        if operation == "describe-log-groups":
            return {"logGroups": [{"logGroupName": self.group, "logGroupClass": "STANDARD"}]}
        if operation in {"create-log-group", "create-log-stream", "put-retention-policy"}:
            return {}
        raise AssertionError(args)


class CollectorTests(unittest.TestCase):
    def test_pages_dedupe_and_allowlist(self):
        collector = FakeCollector()
        self.assertEqual(collector.poll("investigator", 1), 2)
        self.assertEqual(len(collector.uploads), 1)
        events = collector.uploads[0]["logEvents"]
        self.assertEqual(len(events), 2)
        self.assertLess(events[0]["timestamp"], events[1]["timestamp"])
        self.assertNotIn("PRIVATE", json.dumps(events))
        self.assertEqual(json.loads(events[0]["message"])["usage"], {"input_tokens": 5})
        self.assertEqual(collector.poll("investigator", 1), 0)
        self.assertEqual(len(collector.uploads), 1)

    def test_failures_are_retryable(self):
        collector = FakeCollector()
        for mode in ("fail-read", "fail-upload"):
            collector.mode = mode
            with self.assertRaises(MODULE.AwsError):
                collector.poll("api", 1)
            self.assertFalse(collector.sent)
        collector.mode = "normal"
        self.assertEqual(collector.poll("api", 1), 2)

    def test_partial_rejection_acknowledges_accepted_and_quarantines_old(self):
        collector = FakeCollector()
        collector.mode = "partial"
        events = [collector.safe_event(call(i), "api") for i in (1, 2, 3)]
        with patch("sys.stderr"):
            self.assertEqual(collector.send_batch(events, "api"), 1)
        self.assertIn(events[0]["key"], collector.sent)  # terminal quarantine
        self.assertIn(events[1]["key"], collector.sent)  # accepted
        self.assertNotIn(events[2]["key"], collector.sent)  # future timestamp may retry

    def test_retention_only_on_new_group(self):
        collector = FakeCollector()
        collector.mode = "existing"
        collector.initialize()
        self.assertNotIn("put-retention-policy", [c[1] for c in collector.commands])
        collector.commands.clear()
        collector.mode = "normal"
        collector.initialize()
        self.assertIn("put-retention-policy", [c[1] for c in collector.commands])

    def test_assessment_preserves_numeric_snapshots_and_independent_tags(self):
        collector = FakeCollector()
        record = {"schema": "faultglass.watcher_assessment.v1", "event": "watcher.assessed",
                  "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(), "verdict": "FLAG", "outcome": "flagged",
                  "validated_tags": ["FIT-301", "PSL-301"], "model_summary": "PRIVATE",
                  "measurements": {"FIT-301": {"current": 1500, "baseline": 2000, "secret": "PRIVATE"},
                                   "BAD": {"current": 1e100, "baseline": "PRIVATE"}}}
        safe = collector.safe_event(json.dumps(record), "watcher")
        self.assertNotIn("PRIVATE", safe["message"])
        parsed = json.loads(safe["message"])
        self.assertEqual(parsed["validated_tags"], ["FIT-301", "PSL-301"])
        self.assertEqual(parsed["measurements"], {"FIT-301": {"current": 1500, "baseline": 2000}})
        self.assertIsNone(collector.safe_event("{}", "api"))
        self.assertIsNone(collector.safe_event("not JSON", "api"))


if __name__ == "__main__":
    unittest.main()

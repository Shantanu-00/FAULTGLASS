import asyncio
from types import SimpleNamespace

import app.api.console_routes as routes


class FakeRuns:
    def __init__(self, run):
        self.run = run
        self.beats = 0

    async def active(self, plant_id):
        return self.run

    async def heartbeat(self, run_id):
        self.beats += 1
        return True


async def test_run_is_kept_alive_while_a_submission_is_analysed(monkeypatch):
    monkeypatch.setattr(routes, "KEEPALIVE_S", 0.01)
    runs = FakeRuns(SimpleNamespace(id="run-1"))
    state = SimpleNamespace(runs=runs, plant_id="plant")
    async with routes.run_kept_alive(state):
        await asyncio.sleep(0.05)
    beats = runs.beats
    assert beats >= 3
    await asyncio.sleep(0.03)
    assert runs.beats == beats  # stops beating once the analysis is done


async def test_keep_alive_without_an_active_run_is_a_no_op():
    runs = FakeRuns(None)
    async with routes.run_kept_alive(SimpleNamespace(runs=runs, plant_id="plant")):
        await asyncio.sleep(0)
    assert runs.beats == 0

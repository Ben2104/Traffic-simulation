import asyncio
import logging

import pytest

from app.simulation import loop as loop_module
from app.simulation.errors import SimulationError
from app.simulation.loop import run_tick_loop, tick_once
from app.simulation.models import VehicleState


class _StubRunner:
    def __init__(self, vehicles=None, raise_on_step=False, running=True, step_error=None):
        self._vehicles = vehicles or []
        self._raise_on_step = raise_on_step
        self._step_error = step_error
        self.is_running = running
        self.failed = False

    def step(self):
        if self._raise_on_step:
            raise SimulationError("traci died")
        if self._step_error is not None:
            raise self._step_error

    def get_vehicle_states(self):
        return self._vehicles

    def mark_failed(self):
        self.failed = True


async def test_tick_once_returns_vehicle_frame_on_success():
    vehicles = [VehicleState(id="car-1", lat=1.0, lng=2.0, heading=0.0, speed=0.0)]
    runner = _StubRunner(vehicles=vehicles)
    frame = await tick_once(runner, tick=7)
    assert frame == {
        "type": "simulation.vehicles",
        "tick": 7,
        "vehicles": [v.model_dump() for v in vehicles],
    }


async def test_tick_once_returns_error_frame_and_marks_failed_on_step_exception():
    runner = _StubRunner(raise_on_step=True)
    frame = await tick_once(runner, tick=1)
    assert frame["type"] == "simulation.error"
    assert runner.failed is True


async def test_tick_once_returns_offline_frame_when_runner_not_running():
    runner = _StubRunner(running=False)
    frame = await tick_once(runner, tick=1)
    assert frame == {"type": "simulation.error", "message": "simulation offline"}


async def test_tick_once_propagates_programming_errors_without_marking_failed():
    runner = _StubRunner(step_error=TypeError("boom"))
    with pytest.raises(TypeError):
        await tick_once(runner, tick=1)
    assert runner.failed is False


class _RecordingManager:
    def __init__(self) -> None:
        self.frames: list[dict] = []

    async def broadcast(self, message: dict) -> None:
        self.frames.append(message)


async def test_run_tick_loop_survives_an_unexpected_exception_and_reports_it(
    monkeypatch, caplog
):
    # tick_once deliberately lets non-SimulationError exceptions through
    # (see the test above). Before this guard existed, such an exception
    # escaped run_tick_loop's bare `while True`, silently killed the
    # background task, and left the WebSocket open with frozen vehicles and
    # no error banner. The loop must now absorb it, keep ticking, and tell
    # the operator.
    recorder = _RecordingManager()
    monkeypatch.setattr(loop_module, "manager", recorder)
    runner = _StubRunner(step_error=TypeError("unexpected boom"))

    with caplog.at_level(logging.ERROR, logger="app.simulation.loop"):
        task = asyncio.create_task(run_tick_loop(runner, tick_interval=0.01))
        await asyncio.sleep(0.15)

        still_running = not task.done()

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert still_running, "run_tick_loop died on an unexpected exception"
    # mark_failed() must be called on every error path: the frontend store
    # auto-clears errorMessage on the next simulation.vehicles tick, which is
    # only sound while a failed runner can never emit another vehicle frame.
    assert runner.failed is True
    assert len(recorder.frames) >= 2, "loop stopped iterating after the first error"
    assert all(frame["type"] == "simulation.error" for frame in recorder.frames)
    assert "unexpected boom" in recorder.frames[0]["message"]
    assert any(record.exc_info for record in caplog.records)


async def test_run_tick_loop_broadcasts_vehicle_frames_and_advances_the_tick_counter(
    monkeypatch,
):
    recorder = _RecordingManager()
    monkeypatch.setattr(loop_module, "manager", recorder)
    vehicles = [VehicleState(id="car-1", lat=1.0, lng=2.0, heading=0.0, speed=0.0)]
    runner = _StubRunner(vehicles=vehicles)

    task = asyncio.create_task(run_tick_loop(runner, tick_interval=0.01))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(recorder.frames) >= 2
    assert all(frame["type"] == "simulation.vehicles" for frame in recorder.frames)
    ticks = [frame["tick"] for frame in recorder.frames]
    assert ticks == list(range(len(ticks)))

from app.simulation.loop import tick_once
from app.simulation.models import VehicleState


class _StubRunner:
    def __init__(self, vehicles=None, raise_on_step=False, running=True):
        self._vehicles = vehicles or []
        self._raise_on_step = raise_on_step
        self.is_running = running
        self.failed = False

    def step(self):
        if self._raise_on_step:
            raise RuntimeError("traci died")

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

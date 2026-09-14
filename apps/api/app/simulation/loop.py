import asyncio
import logging

from .errors import SimulationError
from ..api.frames import vehicle_frame, error_frame
from ..api.ws import manager

log = logging.getLogger(__name__)


async def tick_once(runner, tick: int) -> dict:
    if not runner.is_running:
        return error_frame("simulation offline")
    try:
        runner.step()
        vehicles = runner.get_vehicle_states()
    except SimulationError as exc:
        runner.mark_failed()
        return error_frame(f"simulation step failed: {exc}")
    return vehicle_frame(tick, vehicles)


async def run_tick_loop(runner, tick_interval: float) -> None:
    tick = 0
    while True:
        # Nothing may be allowed to kill this loop. If it dies the WebSocket
        # stays open, vehicles freeze at their last position and the operator
        # gets no signal at all -- indistinguishable from "the sim is slow".
        # asyncio.CancelledError is a BaseException, so shutdown cancellation
        # still propagates out of this handler untouched.
        try:
            frame = await tick_once(runner, tick)
            await manager.broadcast(frame)
            if frame["type"] == "simulation.vehicles":
                tick += 1
        except Exception as exc:
            # mark_failed() on EVERY error path here is load-bearing: the
            # frontend store auto-clears errorMessage on the next
            # simulation.vehicles tick, which is only safe because a failed
            # runner never produces another vehicle frame.
            runner.mark_failed()
            log.exception("simulation tick loop iteration failed")
            try:
                await manager.broadcast(
                    error_frame(f"simulation tick failed: {exc}")
                )
            except Exception:
                log.exception("failed to broadcast simulation.error frame")
        await asyncio.sleep(tick_interval)

import asyncio

from ..api.frames import vehicle_frame, error_frame
from ..api.ws import manager


async def tick_once(runner, tick: int) -> dict:
    if not runner.is_running:
        return error_frame("simulation offline")
    try:
        runner.step()
        vehicles = runner.get_vehicle_states()
        return vehicle_frame(tick, vehicles)
    except Exception as exc:
        runner.mark_failed()
        return error_frame(f"simulation step failed: {exc}")


async def run_tick_loop(runner, tick_interval: float) -> None:
    tick = 0
    while True:
        frame = await tick_once(runner, tick)
        await manager.broadcast(frame)
        if frame["type"] == "simulation.vehicles":
            tick += 1
        await asyncio.sleep(tick_interval)

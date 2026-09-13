import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import get_settings
from .simulation.runner import SimulationRunner
from .simulation.loop import run_tick_loop
from .incidents.store import IncidentStore
from .api import deps
from .api.ws import router as ws_router
from .api.incidents import router as incidents_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    runner = SimulationRunner(
        net_file=settings.sumo_net_file,
        route_file=settings.sumo_route_file,
        sumo_binary=settings.sumo_binary,
    )
    try:
        runner.start()
    except Exception:
        runner.stop()
        raise
    deps.deps.runner = runner
    deps.deps.store = IncidentStore()

    task = asyncio.create_task(run_tick_loop(runner, settings.tick_interval))
    try:
        yield
    finally:
        task.cancel()
        runner.stop()


app = FastAPI(lifespan=lifespan)
app.include_router(ws_router)
app.include_router(incidents_router)

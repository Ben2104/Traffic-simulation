import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .simulation.runner import SimulationRunner
from .simulation.loop import run_tick_loop
from .incidents.store import IncidentStore
from .api import deps
from .api.ws import router as ws_router
from .api.incidents import router as incidents_router

log = logging.getLogger(__name__)

# Origins allowed to call the HTTP API from a browser. The dashboard's
# GET /incidents fetch is a cross-origin request (3000 -> 8000); WebSocket
# handshakes are not subject to CORS, which is why a WS-only frontend never
# needed this. Kept to the dev origin on purpose -- no wildcard.
CORS_ALLOW_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]


def _log_task_exception(task: asyncio.Task) -> None:
    """Surface a crashed tick-loop task instead of letting its exception sit
    unretrieved in a task nobody ever awaits."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.error("simulation tick loop task exited with an exception", exc_info=exc)


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
    task.add_done_callback(_log_task_exception)
    try:
        yield
    finally:
        task.cancel()
        # Await the cancelled task so its CancelledError is retrieved before
        # the TraCI connection is torn down underneath it.
        with contextlib.suppress(asyncio.CancelledError):
            await task
        runner.stop()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(ws_router)
app.include_router(incidents_router)

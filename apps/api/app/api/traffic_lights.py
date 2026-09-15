from fastapi import APIRouter, HTTPException

from .deps import get_runner

router = APIRouter()


@router.get("/traffic-lights")
async def list_traffic_lights():
    # get_runner() is called directly rather than through Depends() so the
    # unconfigured case can be answered with 503 here, without changing the
    # 500 behaviour the incident routes already rely on.
    try:
        runner = get_runner()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="simulation not ready") from exc
    return {"approaches": runner.get_traffic_light_approaches()}

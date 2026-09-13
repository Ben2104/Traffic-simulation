class Deps:
    runner = None
    store = None


deps = Deps()


def get_runner():
    if deps.runner is None:
        raise RuntimeError("SimulationRunner not configured")
    return deps.runner


def get_store():
    if deps.store is None:
        raise RuntimeError("IncidentStore not configured")
    return deps.store

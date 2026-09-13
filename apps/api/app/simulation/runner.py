import uuid

import traci

from .models import VehicleState, CollisionResult


class SimulationRunner:
    def __init__(
        self,
        net_file: str,
        route_file: str,
        sumo_binary: str = "sumo",
        step_length: float = 1.0,
    ) -> None:
        self.net_file = net_file
        self.route_file = route_file
        self.sumo_binary = sumo_binary
        self.step_length = step_length
        self._label = f"sim-{uuid.uuid4().hex[:8]}"
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running

    def start(self) -> None:
        cmd = [
            self.sumo_binary,
            "-n", self.net_file,
            "-r", self.route_file,
            "--step-length", str(self.step_length),
            "--no-step-log", "true",
            "--no-warnings", "true",
        ]
        traci.start(cmd, label=self._label)
        self._running = True

    def stop(self) -> None:
        if self._running:
            traci.switch(self._label)
            traci.close()
            self._running = False

    def mark_failed(self) -> None:
        self._running = False

    def step(self) -> None:
        traci.switch(self._label)
        traci.simulationStep()

    def get_vehicle_states(self) -> list[VehicleState]:
        traci.switch(self._label)
        states = []
        for veh_id in traci.vehicle.getIDList():
            x, y = traci.vehicle.getPosition(veh_id)
            lon, lat = traci.simulation.convertGeo(x, y)
            states.append(
                VehicleState(
                    id=veh_id,
                    lat=lat,
                    lng=lon,
                    heading=traci.vehicle.getAngle(veh_id),
                    speed=traci.vehicle.getSpeed(veh_id),
                )
            )
        return states

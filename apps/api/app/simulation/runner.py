import uuid

import traci

from .errors import SimulationError
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
        self._started = False

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
        self._started = True
        self._running = True

    def stop(self) -> None:
        if not self._started:
            return
        self._started = False
        self._running = False
        try:
            traci.switch(self._label)
            traci.close()
        except Exception:
            pass  # connection already dead (e.g. after mark_failed()); nothing left to close

    def mark_failed(self) -> None:
        self._running = False

    def step(self) -> None:
        try:
            traci.switch(self._label)
            traci.simulationStep()
        # FatalTraCIError is a *sibling* of TraCIException (both subclass
        # Exception directly), not a subclass, so catching TraCIException
        # alone lets "Connection closed by SUMO." escape every downstream
        # error boundary. Both must be listed explicitly.
        except (traci.TraCIException, traci.FatalTraCIError) as exc:
            raise SimulationError(str(exc)) from exc

    def get_vehicle_states(self) -> list[VehicleState]:
        try:
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
        # See step(): FatalTraCIError is not a subclass of TraCIException.
        except (traci.TraCIException, traci.FatalTraCIError) as exc:
            raise SimulationError(str(exc)) from exc

    def trigger_collision(self, edge_id: str) -> CollisionResult:
        traci.switch(self._label)
        vehicle_ids = [
            v for v in traci.vehicle.getIDList()
            if traci.vehicle.getRoadID(v) == edge_id
        ]
        if not vehicle_ids:
            raise ValueError(f"no vehicles present on edge {edge_id!r}")

        # SUMO rejects a stop positioned inside the vehicle's current braking
        # distance ("too close to brake"). Rather than assume every vehicle
        # can be stopped, compute each one's required stop position (current
        # lane position + braking distance + a small safety margin) and only
        # treat it as stoppable if that position still fits on the lane.
        # Vehicles too close to the lane end are excluded up front, so
        # setStop is only ever called with a position the vehicle can
        # actually reach.
        lane_length = traci.lane.getLength(f"{edge_id}_0")
        candidates: list[tuple[str, float]] = []
        for veh_id in vehicle_ids:
            lane_pos = traci.vehicle.getLanePosition(veh_id)
            speed = traci.vehicle.getSpeed(veh_id)
            decel = traci.vehicle.getDecel(veh_id)
            brake_distance = (speed ** 2) / (2 * decel) if decel > 0 else 0.0
            stop_pos = lane_pos + brake_distance + 1.0
            if stop_pos <= lane_length - 0.1:
                candidates.append((veh_id, stop_pos))

        if not candidates:
            raise ValueError(
                f"no vehicles on edge {edge_id!r} can be brought to a stop "
                "before the end of the lane"
            )

        stopped = candidates[:2]
        first_veh_id = stopped[0][0]
        x, y = traci.vehicle.getPosition(first_veh_id)
        lon, lat = traci.simulation.convertGeo(x, y)

        for veh_id, stop_pos in stopped:
            traci.vehicle.setSpeed(veh_id, 0.0)
            traci.vehicle.setStop(veh_id, edge_id, pos=stop_pos, laneIndex=0, duration=9999)

        stopped_ids = [veh_id for veh_id, _ in stopped]
        return CollisionResult(incident_edge_id=edge_id, vehicle_ids=stopped_ids, lat=lat, lng=lon)

    def pick_busy_edge(self) -> str:
        traci.switch(self._label)
        counts: dict[str, int] = {}
        for veh_id in traci.vehicle.getIDList():
            edge = traci.vehicle.getRoadID(veh_id)
            counts[edge] = counts.get(edge, 0) + 1
        if not counts:
            raise ValueError("no vehicles currently in simulation")
        return max(counts, key=counts.get)

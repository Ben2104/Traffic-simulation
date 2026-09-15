import logging
import math
import uuid

import traci
import traci.constants as tc

from .errors import SimulationError
from .geo import NetworkProjection
from .models import VehicleState, CollisionResult, TrafficLightApproach
from .traffic_lights import group_links_by_incoming_lane, stop_line_heading

log = logging.getLogger(__name__)

# Subscribed once per vehicle, then read in a single getAllSubscriptionResults()
# call per tick. The previous implementation issued four TraCI round-trips per
# vehicle per tick (getPosition, convertGeo, getAngle, getSpeed); at 200
# vehicles on a 0.25 s tick that was roughly 3,200 round-trips per second.
_VEHICLE_SUBSCRIPTIONS = (tc.VAR_POSITION, tc.VAR_ANGLE, tc.VAR_SPEED)

# TLS ids are fixed by the network, so every program is subscribed once at
# startup and the whole set is read in one call per tick.
_TRAFFIC_LIGHT_SUBSCRIPTIONS = (tc.TL_RED_YELLOW_GREEN_STATE,)


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
        self._projection: NetworkProjection | None = None
        self._approaches: list[TrafficLightApproach] | None = None

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def label(self) -> str:
        """The TraCI connection label. Exposed so tests can traci.switch() to
        this runner's connection and compare against reference TraCI calls."""
        return self._label

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
        self._projection = NetworkProjection.from_net_file(self.net_file)
        for tls_id in traci.trafficlight.getIDList():
            traci.trafficlight.subscribe(tls_id, _TRAFFIC_LIGHT_SUBSCRIPTIONS)

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
            # Subscribe vehicles as they enter. One round-trip per tick for the
            # departed list, instead of one per vehicle per tick forever after.
            for veh_id in traci.simulation.getDepartedIDList():
                try:
                    traci.vehicle.subscribe(veh_id, _VEHICLE_SUBSCRIPTIONS)
                except traci.TraCIException:
                    # A vehicle that departed and arrived within the same step is
                    # already gone by the time we subscribe, and SUMO answers
                    # "Vehicle '<id>' is not known". Skipping it is correct: it has
                    # no state left to stream. Letting it through would surface as a
                    # SimulationError and mark_failed() the runner permanently,
                    # killing all traffic over one vanished vehicle.
                    continue

            # Unsubscribe vehicles that have left the network, mirroring the
            # subscribe-on-departed loop above. traci.simulation.getArrivedIDList()
            # alone is NOT sufficient for this: confirmed empirically against
            # the live soma network (see task-14-fix-report.md) that a vehicle
            # can drop out of traci.vehicle.getIDList() and sit in
            # getAllSubscriptionResults() holding the INVALID_DOUBLE_VALUE
            # sentinel for 30+ consecutive ticks with no matching entry ever
            # appearing in getArrivedIDList() -- SUMO does not route every
            # kind of vehicle removal through that list. Reconciling the
            # subscription cache against the live fleet directly, every tick,
            # is what actually closes the leak: any id SUMO is still
            # reporting a subscription result for, but that is no longer in
            # getIDList(), is stale and is dropped here rather than left to
            # accumulate (and rather than trusted to eventually self-clear).
            live_ids = set(traci.vehicle.getIDList())
            stale_ids = set(traci.vehicle.getAllSubscriptionResults().keys()) - live_ids
            for veh_id in stale_ids:
                try:
                    traci.vehicle.unsubscribe(veh_id)
                except traci.TraCIException:
                    # Already gone from the server's subscription table too;
                    # nothing left to clean up.
                    continue
        # FatalTraCIError is a *sibling* of TraCIException (both subclass
        # Exception directly), not a subclass, so catching TraCIException
        # alone lets "Connection closed by SUMO." escape every downstream
        # error boundary. Both must be listed explicitly.
        except (traci.TraCIException, traci.FatalTraCIError) as exc:
            raise SimulationError(str(exc)) from exc

    def get_vehicle_states(self) -> list[VehicleState]:
        # Reads the local subscription-result cache populated by the last
        # step() call and performs no socket I/O of its own. A dead TraCI
        # connection is therefore NOT detected here - callers that need to
        # detect one must call step(), which still round-trips to the socket.
        try:
            traci.switch(self._label)
            states = []
            for veh_id, values in traci.vehicle.getAllSubscriptionResults().items():
                # A vehicle can be present in the result map with an incomplete
                # value set if it departed between the subscribe and the read.
                # Skip it rather than raising a KeyError that would escape
                # every SimulationError boundary as a programming error.
                if tc.VAR_POSITION not in values:
                    continue
                x, y = values[tc.VAR_POSITION]
                heading = values[tc.VAR_ANGLE]
                speed = values[tc.VAR_SPEED]
                # TraCI reports its INVALID_DOUBLE_VALUE sentinel (-2**30) for
                # a subscribed variable it cannot currently supply -- observed
                # in production for vehicles whose subscription result never
                # recovers a real value on any later tick (see
                # task-14-fix-report.md). A sentinel position sits far outside
                # NetworkProjection's coordinate domain, so to_lon_lat() maps
                # it to +-inf. Starlette's WebSocket.send_json serialises with
                # allow_nan=True by default, so an inf lat/lng (or a bare
                # sentinel heading/speed) is written as a literal `Infinity`
                # token -- not valid JSON -- and the browser's JSON.parse
                # throws on the WHOLE frame over this one vehicle. Drop it
                # here rather than forward a non-finite value.
                if tc.INVALID_DOUBLE_VALUE in (x, y, heading, speed):
                    continue
                lon, lat = self._projection.to_lon_lat(x, y)
                # Belt-and-braces beyond the sentinel check above: any other
                # cause of a non-finite projected coordinate (e.g. a future
                # network/projection edge case) must not reach the client
                # either, for the same JSON.parse reason.
                if not (math.isfinite(lat) and math.isfinite(lon)):
                    continue
                states.append(
                    VehicleState(
                        id=veh_id,
                        lat=lat,
                        lng=lon,
                        heading=heading,
                        speed=speed,
                    )
                )
            return states
        # See step(): FatalTraCIError is not a subclass of TraCIException.
        except (traci.TraCIException, traci.FatalTraCIError) as exc:
            raise SimulationError(str(exc)) from exc

    def get_traffic_light_approaches(self) -> list[TrafficLightApproach]:
        """Signal geometry for every controlled approach in the network.

        Static for the life of the simulation, so it is computed once and
        cached: 51 tlLogic programs mean ~500 lane-shape lookups, which is far
        too many round-trips to repeat per tick.
        """
        if self._approaches is not None:
            return self._approaches

        traci.switch(self._label)
        approaches: list[TrafficLightApproach] = []
        for tls_id in traci.trafficlight.getIDList():
            controlled_links = traci.trafficlight.getControlledLinks(tls_id)
            for lane_id, indices in group_links_by_incoming_lane(controlled_links).items():
                shape = traci.lane.getShape(lane_id)
                # A degenerate one-point shape has no direction to derive a
                # heading from; skipping is better than emitting a marker
                # pointing an arbitrary way.
                if len(shape) < 2:
                    continue
                x, y = shape[-1]
                lon, lat = self._projection.to_lon_lat(x, y)
                approaches.append(
                    TrafficLightApproach(
                        tls_id=tls_id,
                        lane_id=lane_id,
                        link_indices=indices,
                        lat=lat,
                        lng=lon,
                        heading=stop_line_heading(shape),
                    )
                )

        self._approaches = approaches
        return approaches

    def get_traffic_light_states(self) -> dict[str, str]:
        """Current phase string for every signal program, keyed by TLS id."""
        try:
            traci.switch(self._label)
            return {
                tls_id: values[tc.TL_RED_YELLOW_GREEN_STATE]
                for tls_id, values in traci.trafficlight.getAllSubscriptionResults().items()
                if tc.TL_RED_YELLOW_GREEN_STATE in values
            }
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
        lon, lat = self._projection.to_lon_lat(x, y)

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
        counts = {
            e: n for e, n in counts.items()
            if not e.startswith(":")   # skip junction-internal edges
        }
        if not counts:
            raise ValueError("no vehicles currently in simulation")
        return max(counts, key=counts.get)

import math


def group_links_by_incoming_lane(controlled_links) -> dict[str, list[int]]:
    """Map each incoming lane to the state-string indices that control it.

    `controlled_links` is traci.trafficlight.getControlledLinks() output: a
    list whose index matches the position of that link's character in the TLS
    state string, each entry being a list of
    (incoming_lane, outgoing_lane, via_lane) tuples.

    Grouping by incoming lane is what turns a 40-character state string into
    the handful of markers an operator can actually read: one per approach,
    answering "can traffic coming this way go?"
    """
    groups: dict[str, list[int]] = {}
    for index, links in enumerate(controlled_links):
        for incoming_lane, _outgoing_lane, _via_lane in links:
            indices = groups.setdefault(incoming_lane, [])
            if index not in indices:
                indices.append(index)
    return groups


def stop_line_heading(shape) -> float:
    """Compass bearing of a lane's final segment, in degrees clockwise from
    north -- the same convention traci.vehicle.getAngle() uses.

    SUMO's cartesian frame is x=east, y=north, so the arguments to atan2 are
    (dx, dy) rather than the (dy, dx) of a standard mathematical angle.
    """
    (x1, y1), (x2, y2) = shape[-2], shape[-1]
    return math.degrees(math.atan2(x2 - x1, y2 - y1)) % 360.0

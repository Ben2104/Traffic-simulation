import xml.etree.ElementTree as ET

from pyproj import Transformer


class NetworkProjection:
    """Converts SUMO network coordinates to WGS84 in-process.

    Replaces traci.simulation.convertGeo, which costs one socket round-trip
    per vehicle per tick. The transform is exact: it uses the same
    projParameter netconvert recorded in the network file.
    """

    def __init__(self, proj_parameter: str, net_offset: tuple[float, float]) -> None:
        self.proj_parameter = proj_parameter
        self.net_offset = net_offset
        self._offset_x, self._offset_y = net_offset
        # "!" is SUMO's sentinel for "this network has no real georeference"
        # (synthetic/test networks generated without netconvert's --proj.*
        # options). traci.simulation.convertGeo treats it as an identity
        # transform -- verified empirically against the fixture network used
        # in tests/simulation/fixtures/fixture.net.xml, which returns (x, y)
        # unchanged. pyproj can't parse "!" as a CRS, so it must be handled
        # before reaching Transformer.from_crs.
        if proj_parameter == "!":
            self._transformer = None
        else:
            # always_xy=True is MANDATORY. pyproj 2+ honours CRS axis order,
            # so EPSG:4326 yields (lat, lon) without it -- a silent
            # coordinate swap that puts every vehicle in the Indian Ocean.
            self._transformer = Transformer.from_crs(
                proj_parameter, "EPSG:4326", always_xy=True
            )

    @classmethod
    def from_net_file(cls, net_file: str) -> "NetworkProjection":
        # soma.net.xml is 5.5 MB. <location> is the first element after the
        # root, so iterparse and bail out before the edge list is walked.
        for _event, elem in ET.iterparse(net_file, events=("start",)):
            if elem.tag == "location":
                offset_x, offset_y = (float(v) for v in elem.get("netOffset").split(","))
                return cls(elem.get("projParameter"), (offset_x, offset_y))
            if elem.tag == "edge":
                break
        raise ValueError(f"no <location> element found in {net_file!r}")

    def to_lon_lat(self, x: float, y: float) -> tuple[float, float]:
        """SUMO (x, y) -> (lon, lat).

        netOffset is the offset netconvert ADDED to the original projected
        coordinates, so the original is recovered by subtracting it.
        """
        offset_x, offset_y = x - self._offset_x, y - self._offset_y
        if self._transformer is None:
            return offset_x, offset_y
        return self._transformer.transform(offset_x, offset_y)

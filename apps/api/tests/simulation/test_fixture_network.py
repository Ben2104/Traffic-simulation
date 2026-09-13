import os
import xml.etree.ElementTree as ET

FIXTURES_DIR = os.path.dirname(__file__)
NET_FILE = os.path.join(FIXTURES_DIR, "fixtures", "fixture.net.xml")


def test_fixture_network_has_expected_edges():
    tree = ET.parse(NET_FILE)
    edge_ids = {e.get("id") for e in tree.getroot().findall("edge") if e.get("function") != "internal"}
    assert edge_ids == {"AB", "BC"}

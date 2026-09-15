import { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSimulationStore } from "../lib/store";
import { STYLE_URL } from "../lib/map-style";

// react-map-gl needs a real WebGL context, so the map itself is stubbed. What
// is under test here is the wiring: the initial camera, the controls being
// mounted, the basemap prop reacting to those controls, and the approach
// fetch -- not Mapbox's rendering. MapControls is NOT mocked: it renders for
// real so a click on its Satellite radio exercises the actual dispatch ->
// reducer -> mapStyle prop path.
const initialViewStates: unknown[] = [];
const mapStyles: string[] = [];

vi.mock("react-map-gl/mapbox", () => ({
  default: (props: { initialViewState: unknown; mapStyle: string; children: React.ReactNode }) => {
    initialViewStates.push(props.initialViewState);
    mapStyles.push(props.mapStyle);
    return <div data-testid="map-stub">{props.children}</div>;
  },
  useControl: () => ({ setProps: () => {} }),
}));

vi.mock("@deck.gl/mapbox", () => ({ MapboxOverlay: class {} }));

import MapView from "../components/MapView";

// A single macrotask boundary flushes every pending microtask, however many
// `.then`/`.catch` hops the fetch chain under test has -- unlike awaiting one
// promise in the chain directly, this doesn't depend on knowing that depth.
async function flushPromises() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("MapView", () => {
  beforeEach(() => {
    initialViewStates.length = 0;
    mapStyles.length = 0;
    useSimulationStore.setState({ approaches: [], signals: {} });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          approaches: [
            {
              tls_id: "tls-1",
              lane_id: "north_0",
              link_indices: [0],
              lat: 37.7765,
              lng: -122.3946,
              heading: 90,
            },
          ],
        }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the camera tilted at zoom 16.5", () => {
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    expect(initialViewStates[0]).toMatchObject({
      pitch: 45,
      bearing: -17,
      zoom: 16.5,
    });
  });

  it("mounts the map controls", () => {
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    expect(screen.getByTestId("map-controls")).toBeInTheDocument();
  });

  it("fetches approach geometry once and stores it", async () => {
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    await waitFor(() => {
      expect(useSimulationStore.getState().approaches).toHaveLength(1);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/traffic-lights");
  });

  it("renders the map even when the approach fetch fails", async () => {
    // Signal geometry is decorative and the API may simply not be up yet.
    // First paint must never be blocked on it.
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    expect(screen.getByTestId("map-stub")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await flushPromises();
    expect(useSimulationStore.getState().approaches).toEqual([]);
  });

  it("does not store approaches on a non-ok response", async () => {
    // The body carries a well-formed payload on purpose: this test must fail
    // because of the `response.ok` check specifically, not because the body
    // also happens to be malformed. A body-shape mismatch would mask a
    // regression that drops the ok check entirely.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        approaches: [
          {
            tls_id: "tls-1",
            lane_id: "north_0",
            link_indices: [0],
            lat: 37.7765,
            lng: -122.3946,
            heading: 90,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await flushPromises();
    expect(useSimulationStore.getState().approaches).toEqual([]);
  });

  it("switches the basemap to satellite when the Satellite radio is selected", async () => {
    const user = userEvent.setup();
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    expect(mapStyles[mapStyles.length - 1]).toBe(STYLE_URL.standard);

    await user.click(screen.getByRole("radio", { name: "Satellite" }));

    await waitFor(() => {
      expect(mapStyles[mapStyles.length - 1]).toBe(STYLE_URL.satellite);
    });
  });
});

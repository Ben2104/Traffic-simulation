import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MapControls from "../components/MapControls";
import { INITIAL_MAP_STYLE } from "../lib/map-style";

function setup(overrides = {}, props = {}) {
  const dispatch = vi.fn();
  render(
    <MapControls
      state={{ ...INITIAL_MAP_STYLE, ...overrides }}
      dispatch={dispatch}
      {...props}
    />
  );
  return { dispatch };
}

describe("MapControls", () => {
  it("renders both basemap options", () => {
    setup();
    expect(screen.getByRole("radio", { name: /standard/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /satellite/i })).toBeInTheDocument();
  });

  it("marks the active basemap as checked", () => {
    setup({ basemap: "satellite" });
    expect(screen.getByRole("radio", { name: /satellite/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /standard/i })).not.toBeChecked();
  });

  it("dispatches setBasemap when the other basemap is picked", async () => {
    const { dispatch } = setup();
    await userEvent.click(screen.getByRole("radio", { name: /satellite/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "setBasemap",
      basemap: "satellite",
    });
  });

  it.each([
    [/3d buildings/i, "buildings3d"],
    [/terrain/i, "terrain"],
    [/night/i, "night"],
  ])("dispatches a toggle for %s", async (label, key) => {
    const { dispatch } = setup();
    await userEvent.click(screen.getByRole("checkbox", { name: label }));
    expect(dispatch).toHaveBeenCalledWith({ type: "toggle", key });
  });

  it("reflects toggle state in the checkboxes", () => {
    setup({ buildings3d: true, terrain: false, night: true });
    expect(screen.getByRole("checkbox", { name: /3d buildings/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /terrain/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /night/i })).toBeChecked();
  });

  it("hides the night toggle on Satellite, which has no light presets", () => {
    setup({ basemap: "satellite" });
    expect(screen.queryByRole("checkbox", { name: /night/i })).toBeNull();
  });

  it("disables the buildings toggle when the style cannot support it", () => {
    setup({ basemap: "satellite" }, { buildingsDisabled: true });
    expect(screen.getByRole("checkbox", { name: /3d buildings/i })).toBeDisabled();
  });
});

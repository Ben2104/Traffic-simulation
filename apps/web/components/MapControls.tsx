"use client";
import type { Basemap, MapStyleAction, MapStyleState } from "../lib/map-style";

export interface MapControlsProps {
  state: MapStyleState;
  dispatch: (action: MapStyleAction) => void;
  /** Set when the loaded style has no building geometry to extrude. */
  buildingsDisabled?: boolean;
}

const BASEMAPS: { value: Basemap; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "satellite", label: "Satellite" },
];

export default function MapControls({
  state,
  dispatch,
  buildingsDisabled = false,
}: MapControlsProps) {
  return (
    <div
      data-testid="map-controls"
      className="absolute right-3 top-3 z-10 flex flex-col gap-2 rounded border border-outline-variant bg-surface-container/90 p-3 backdrop-blur-sm"
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="text-label-caps text-on-surface-variant">Basemap</legend>
        {BASEMAPS.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-2 text-mono-sm">
            <input
              type="radio"
              name="basemap"
              value={value}
              checked={state.basemap === value}
              onChange={() => dispatch({ type: "setBasemap", basemap: value })}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-1 border-t border-outline-variant pt-2">
        <legend className="text-label-caps text-on-surface-variant">Layers</legend>

        <label className="flex items-center gap-2 text-mono-sm">
          <input
            type="checkbox"
            checked={state.buildings3d}
            disabled={buildingsDisabled}
            onChange={() => dispatch({ type: "toggle", key: "buildings3d" })}
          />
          3D Buildings
        </label>

        <label className="flex items-center gap-2 text-mono-sm">
          <input
            type="checkbox"
            checked={state.terrain}
            onChange={() => dispatch({ type: "toggle", key: "terrain" })}
          />
          Terrain
        </label>

        {/* Light presets are a Standard-style feature; classic styles such as
            satellite-streets have none, so the control is withdrawn rather
            than left inert. */}
        {state.basemap === "standard" && (
          <label className="flex items-center gap-2 text-mono-sm">
            <input
              type="checkbox"
              checked={state.night}
              onChange={() => dispatch({ type: "toggle", key: "night" })}
            />
            Night
          </label>
        )}
      </fieldset>
    </div>
  );
}

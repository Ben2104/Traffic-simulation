/**
 * Basemap and 3D-toggle state, plus the declarative instruction list that
 * re-applies it to a Mapbox map.
 *
 * map.setStyle() destroys every custom source and layer, so terrain and the
 * satellite extrusion layer have to be re-added on each style load. Expressing
 * that as a pure state -> instruction[] function keeps the only genuinely
 * untestable part (the Mapbox calls) down to a thin interpreter in MapView.
 */

export type Basemap = "standard" | "satellite";

export const STYLE_URL: Record<Basemap, string> = {
  standard: "mapbox://styles/mapbox/standard",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
};

export const DEM_SOURCE_ID = "mapbox-dem";
export const DEM_SOURCE_URL = "mapbox://mapbox.mapbox-terrain-dem-v1";
export const EXTRUSION_LAYER_ID = "satellite-3d-buildings";
export const TERRAIN_EXAGGERATION = 1.5;

/**
 * Zoom 16.5 rather than the previous 15.5 because Mapbox Standard's detailed
 * road rendering -- lane markings, crosswalks, turn arrows, 3D trees -- only
 * appears from about z16. The cost is roughly four blocks of view instead of
 * the whole SoMa grid.
 */
export const DEFAULT_VIEW_STATE = {
  longitude: -122.4,
  latitude: 37.781,
  zoom: 16.5,
  pitch: 45,
  bearing: -17,
};

export interface MapStyleState {
  basemap: Basemap;
  buildings3d: boolean;
  terrain: boolean;
  night: boolean;
}

export const INITIAL_MAP_STYLE: MapStyleState = {
  basemap: "standard",
  buildings3d: true,
  terrain: false,
  night: false,
};

export type MapStyleAction =
  | { type: "setBasemap"; basemap: Basemap }
  | { type: "toggle"; key: "buildings3d" | "terrain" | "night" };

export function mapStyleReducer(
  state: MapStyleState,
  action: MapStyleAction
): MapStyleState {
  switch (action.type) {
    case "setBasemap":
      return { ...state, basemap: action.basemap };
    case "toggle":
      return { ...state, [action.key]: !state[action.key] };
  }
}

export type Instruction =
  | {
      op: "setConfigProperty";
      property: "show3dObjects" | "lightPreset";
      value: boolean | string;
    }
  | { op: "addExtrusionLayer" }
  | { op: "removeExtrusionLayer" }
  | { op: "addTerrain" }
  | { op: "removeTerrain" };

/**
 * The complete set of operations that brings a freshly loaded style into
 * agreement with `state`. Always complete, never a delta: it is replayed
 * wholesale after every setStyle, which wipes everything it describes.
 */
export function reapplyPlan(state: MapStyleState): Instruction[] {
  const plan: Instruction[] = [];

  if (state.basemap === "standard") {
    // Standard owns its buildings and lighting; a custom extrusion layer
    // cannot be added because it does not expose its source schema.
    plan.push({
      op: "setConfigProperty",
      property: "show3dObjects",
      value: state.buildings3d,
    });
    plan.push({
      op: "setConfigProperty",
      property: "lightPreset",
      value: state.night ? "night" : "day",
    });
  } else {
    // satellite-streets-v12 is a classic style: no config properties, so the
    // same toggle means adding or removing a fill-extrusion layer by hand.
    plan.push(
      state.buildings3d
        ? { op: "addExtrusionLayer" }
        : { op: "removeExtrusionLayer" }
    );
  }

  plan.push(state.terrain ? { op: "addTerrain" } : { op: "removeTerrain" });
  return plan;
}

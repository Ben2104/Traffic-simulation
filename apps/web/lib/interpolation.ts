import type { VehicleState } from "./types";

export function interpolateVehicles(
  previous: VehicleState[],
  current: VehicleState[],
  tickDurationMs: number,
  elapsedMs: number
): VehicleState[] {
  const t = Math.min(Math.max(elapsedMs / tickDurationMs, 0), 1);
  const previousById = new Map(previous.map((v) => [v.id, v]));
  return current.map((curr) => {
    const prev = previousById.get(curr.id);
    if (!prev) return curr;
    return {
      ...curr,
      lat: prev.lat + (curr.lat - prev.lat) * t,
      lng: prev.lng + (curr.lng - prev.lng) * t,
    };
  });
}

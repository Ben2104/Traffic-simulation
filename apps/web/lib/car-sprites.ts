/**
 * Civilian car sprites, drawn in-repo with Canvas 2D path commands.
 *
 * Drawn rather than loaded because rasterising SVG requires an async Image
 * round-trip, which would force every caller of buildSpriteAtlas to be async.
 *
 * Pre-tinted rather than tinted at draw time because deck.gl's IconLayer
 * only applies getColor to icons declared `mask: true`, and a masked icon
 * renders as a flat silhouette with no windows or lights. Baking 3 bodies x
 * 20 colours into the atlas keeps the detail in a single draw call -- and the
 * emergency liveries arriving in a later slice are pre-coloured and must not
 * be tinted at all, so one uniform `mask: false` pipeline serves both.
 */

export const CELL_WIDTH = 64;
export const CELL_HEIGHT = 128;

export const BODY_KEYS = ["sedan", "suv", "truck"] as const;
export type BodyKey = (typeof BODY_KEYS)[number];

/**
 * Deliberately excludes red and red/white/blue: those are reserved for police,
 * ambulance and fire liveries, which must stay instantly distinguishable at
 * the ~14px these render at.
 */
export const CIVILIAN_PALETTE = [
  "#e8e8ea", "#b9bec6", "#8d949e", "#5f6670", "#3a4048",
  "#1d2127", "#2f4b7c", "#1b6ca8", "#2a9d8f", "#2f7d54",
  "#6aa84f", "#b7c94a", "#e9c46a", "#e0a458", "#b98a4a",
  "#8a6240", "#6b4f3f", "#7d5ba6", "#4b4e8f", "#a8a29e",
] as const;

export interface SpriteAtlas {
  canvas: HTMLCanvasElement;
  mapping: Record<
    string,
    { x: number; y: number; width: number; height: number; mask: false }
  >;
}

/** FNV-1a, 32-bit, returned unsigned. */
export function hashVehicleId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function spriteKeyForVehicle(id: string, _kind: string): string {
  // `_kind` is unused for civilians but is the hook the emergency liveries
  // key off in a later slice; keeping it in the signature now means no
  // call-site churn then.
  const hash = hashVehicleId(id);
  const body = BODY_KEYS[hash % BODY_KEYS.length];
  // Shift before the second modulo so body and colour do not correlate.
  const colorIndex = (hash >>> 8) % CIVILIAN_PALETTE.length;
  return `${body}-${colorIndex}`;
}

function shade(hex: string, amount: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(parseInt(hex.slice(1, 3), 16) * (1 + amount));
  const g = clamp(parseInt(hex.slice(3, 5), 16) * (1 + amount));
  const b = clamp(parseInt(hex.slice(5, 7), 16) * (1 + amount));
  return `rgb(${r},${g},${b})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

const GLASS = "rgba(18,24,32,0.88)";
const HEADLIGHT = "#fff4cc";
const TAILLIGHT = "#d64545";

/** All bodies are drawn nose-up (front towards -y) in a CELL_WIDTH x
 * CELL_HEIGHT box. The layer rotates them with getAngle = -heading. */
function drawBody(
  ctx: CanvasRenderingContext2D,
  body: BodyKey,
  color: string
): void {
  const w = CELL_WIDTH;
  const h = CELL_HEIGHT;
  const inset = body === "truck" ? 0.08 : 0.12;
  const radius = body === "truck" ? w * 0.1 : w * 0.22;

  ctx.fillStyle = color;
  roundRect(ctx, w * inset, h * 0.03, w * (1 - inset * 2), h * 0.94, radius);

  ctx.fillStyle = shade(color, -0.18);
  if (body === "truck") {
    // Cab, then a flat load bed.
    roundRect(ctx, w * 0.14, h * 0.06, w * 0.72, h * 0.3, w * 0.07);
    ctx.fillStyle = shade(color, -0.3);
    roundRect(ctx, w * 0.14, h * 0.42, w * 0.72, h * 0.5, w * 0.04);
  } else {
    const roofTop = body === "suv" ? 0.28 : 0.36;
    const roofHeight = body === "suv" ? 0.42 : 0.28;
    roundRect(ctx, w * 0.2, h * roofTop, w * 0.6, h * roofHeight, w * 0.06);
  }

  ctx.fillStyle = GLASS;
  roundRect(ctx, w * 0.21, h * 0.17, w * 0.58, h * 0.13, w * 0.05);
  if (body !== "truck") {
    roundRect(ctx, w * 0.21, h * 0.7, w * 0.58, h * 0.12, w * 0.05);
  }

  ctx.fillStyle = HEADLIGHT;
  ctx.fillRect(w * 0.17, h * 0.045, w * 0.16, h * 0.028);
  ctx.fillRect(w * 0.67, h * 0.045, w * 0.16, h * 0.028);

  ctx.fillStyle = TAILLIGHT;
  ctx.fillRect(w * 0.17, h * 0.935, w * 0.16, h * 0.025);
  ctx.fillRect(w * 0.67, h * 0.935, w * 0.16, h * 0.025);
}

export function buildSpriteAtlas(): SpriteAtlas | null {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = CELL_WIDTH * CIVILIAN_PALETTE.length;
  canvas.height = CELL_HEIGHT * BODY_KEYS.length;

  const ctx = canvas.getContext("2d");
  // jsdom returns null here (no canvas backend), as does any server render.
  if (!ctx) return null;

  const mapping: SpriteAtlas["mapping"] = {};
  BODY_KEYS.forEach((body, row) => {
    CIVILIAN_PALETTE.forEach((color, column) => {
      const x = column * CELL_WIDTH;
      const y = row * CELL_HEIGHT;
      ctx.save();
      ctx.translate(x, y);
      drawBody(ctx, body, color);
      ctx.restore();
      mapping[`${body}-${column}`] = {
        x,
        y,
        width: CELL_WIDTH,
        height: CELL_HEIGHT,
        mask: false,
      };
    });
  });

  return { canvas, mapping };
}

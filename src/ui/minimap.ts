// Inline SVG mini-map built from a MapData (the GM's truth, or the party view for players).
// Pure: no Foundry globals, so it is unit-testable; grid orientation is passed in.
import type { HexKey, LegPlan, MapData } from "../types";
import { esc } from "./html";
import { TERRAINS } from "../canvas";
import { DEFAULT_LANDMARK_ICON, glyphOr, landmarkIcon, symbolColor } from "../canvas/icons";

export interface GridShape {
  columns: boolean; // column-based (flat-top) hex grid; default row-based (pointy-top)
  even: boolean; // even rows/columns are the offset ones
}

export interface MiniMapOptions {
  grid: GridShape;
  position?: HexKey | null;
  legPath?: HexKey[]; // current leg, highlighted
  selectedRouteId?: string | null;
  routesClickable?: boolean;
}

const R = 10; // hex circumradius in SVG units
const SQRT3 = Math.sqrt(3);

const PALETTE: Record<string, string> = {
  plains: "#b5c77a",
  grassland: "#a8c46a",
  forest: "#4f7d43",
  jungle: "#2f6b3a",
  hills: "#a89060",
  mountains: "#8a8580",
  mountain: "#8a8580",
  desert: "#e3c784",
  dunes: "#e8b968",
  "salt flat": "#e9e4d4",
  swamp: "#5f7356",
  marsh: "#6f8a63",
  water: "#5b8fc9",
  lake: "#5b8fc9",
  sea: "#3f6fa8",
  tundra: "#cfd8dc",
  road: "#c9b48f",
  urban: "#9e9e9e",
};

export function terrainColor(terrain: string, regionColor?: string | null): string {
  const key = terrain.trim().toLowerCase();
  const shared = TERRAINS[key]?.fill;
  if (shared) return shared;
  if (PALETTE[key]) return PALETTE[key];
  if (regionColor) return regionColor;
  // Stable fallback colour per free-text label.
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 35%, 55%)`;
}

export function parseKey(key: HexKey): { i: number; j: number } | null {
  const [i, j] = key.split(",").map(Number);
  return Number.isFinite(i) && Number.isFinite(j) ? { i, j } : null;
}

const odd = (n: number) => ((n % 2) + 2) % 2 === 1;

export function hexCenter(key: HexKey, grid: GridShape): { x: number; y: number } | null {
  const p = parseKey(key);
  if (!p) return null;
  if (grid.columns) {
    const h = SQRT3 * R;
    const shifted = grid.even ? !odd(p.j) : odd(p.j);
    return { x: p.j * 1.5 * R, y: p.i * h + (shifted ? h / 2 : 0) };
  }
  const w = SQRT3 * R;
  const shifted = grid.even ? !odd(p.i) : odd(p.i);
  return { x: p.j * w + (shifted ? w / 2 : 0), y: p.i * 1.5 * R };
}

export function hexPoints(center: { x: number; y: number }, grid: GridShape): string {
  const start = grid.columns ? 0 : 30;
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((start + 60 * k) * Math.PI) / 180;
    pts.push(`${(center.x + R * Math.cos(a)).toFixed(2)},${(center.y + R * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function polyline(keys: HexKey[], grid: GridShape): string {
  return keys
    .map((k) => hexCenter(k, grid))
    .filter((c): c is { x: number; y: number } => !!c)
    .map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(" ");
}

/** Hexes of a leg plan that may be drawn on this map (only hexes the map contains, plus the start). */
export function visiblePath(plan: LegPlan | null | undefined, map: MapData): HexKey[] {
  if (!plan) return [];
  return [plan.from, ...plan.path].filter((k) => !!map.hexes[k]);
}

export function renderMiniMap(map: MapData, opts: MiniMapOptions): string {
  const { grid } = opts;
  const hexes = Object.values(map.hexes);
  if (!hexes.length) return `<p class="pf1hex-empty">No mapped hexes.</p>`;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const cells: string[] = [];
  for (const hex of hexes) {
    const c = hexCenter(hex.key, grid);
    if (!c) continue;
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    const region = hex.region ? map.regions[hex.region] : undefined;
    const fill = terrainColor(hex.terrain, region?.color);
    const title = `${hex.terrain} (${hex.difficulty})${region ? ` — ${region.name}` : ""}`;
    cells.push(
      `<polygon class="hex" points="${hexPoints(c, grid)}" fill="${esc(fill)}"><title>${esc(title)}</title></polygon>`,
    );
  }

  const routes = Object.values(map.routes).map((route) => {
    const pts = polyline([route.from, ...route.hexes], grid);
    if (!pts) return "";
    const selected = route.id === opts.selectedRouteId;
    const action = opts.routesClickable ? ` data-action="pickRoute" data-route-id="${esc(route.id)}"` : "";
    const stroke = route.color && !selected ? ` style="stroke:${esc(route.color)}"` : "";
    return `<polyline class="route${selected ? " selected" : ""}" points="${pts}"${stroke}${action}><title>${esc(
      `${route.name} — ${route.days}d, ${route.difficulty}`,
    )}</title></polyline>`;
  });

  const leg = opts.legPath?.length ? `<polyline class="leg-path" points="${polyline(opts.legPath, grid)}"/>` : "";

  const landmarks = Object.values(map.landmarks).map((lm) => {
    const c = hexCenter(lm.hex, grid);
    if (!c) return "";
    const color = symbolColor(map, lm.hex);
    const glyph = glyphOr(landmarkIcon(lm), DEFAULT_LANDMARK_ICON);
    if (!glyph) {
      return `<circle class="landmark" cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${R * 0.35}" style="fill:${esc(color)}"><title>${esc(
        lm.name,
      )}</title></circle>`;
    }
    return `<text class="landmark-icon" x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" font-size="${(R * 0.9).toFixed(2)}"
      font-family="${esc(glyph.fontFamily)}" font-weight="${esc(glyph.fontWeight)}" text-anchor="middle" dominant-baseline="central"
      style="fill:${esc(color)}">${esc(glyph.char)}<title>${esc(lm.name)}</title></text>`;
  });

  const posCenter = opts.position ? hexCenter(opts.position, grid) : null;
  const marker = posCenter
    ? `<circle class="caravan" cx="${posCenter.x.toFixed(2)}" cy="${posCenter.y.toFixed(2)}" r="${R * 0.5}"><title>Caravan</title></circle>`
    : "";

  const pad = R * 1.5;
  const vb = [minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad].map((n) => n.toFixed(2)).join(" ");
  return `<svg class="pf1hex-minimap" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
<g class="hexes">${cells.join("")}</g><g class="routes">${routes.join("")}</g>${leg}<g class="landmarks">${landmarks.join(
    "",
  )}</g>${marker}</svg>`;
}

/** Grid shape from the live canvas, defaulting to row-based. */
export function canvasGridShape(): GridShape {
  const grid = (globalThis as any).canvas?.grid;
  return { columns: !!grid?.columns, even: !!grid?.even };
}

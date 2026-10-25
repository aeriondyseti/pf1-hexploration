// Pure helpers for the canvas layer and painter (no Foundry globals; unit-tested).
import type { Difficulty, GmPrompt, HexDefaults, HexKey, HexRecord, KnowledgeState, MapData, RouteEffect } from "../types";
import { routeLabel } from "../types";

export const DIFFICULTY_LETTER: Record<Difficulty, string> = { easy: "E", standard: "S", hard: "H", brutal: "B" };

export function hexKey(o: { i: number; j: number }): HexKey {
  return `${o.i},${o.j}`;
}

export function parseHexKey(key: HexKey): { i: number; j: number } {
  const [i, j] = key.split(",").map(Number);
  return { i, j };
}

export type BrushOp =
  | { kind: "terrain"; terrain: string; difficulty: Difficulty; encounterMod?: number | null } // null/absent: keep
  | { kind: "region"; regionId: string | null }
  | { kind: "tag"; tag: string; add: boolean }
  | { kind: "erase" };

/** Where a new hex's starting values come from: a fixed fallback, or a lookup by the region it is created in. */
export type HexDefaultsSource =
  | { terrain: string; difficulty: Difficulty; tags?: string[]; encounterMod?: number }
  | ((regionId: string | null) => HexDefaults);

/**
 * The defaults stamped onto a hex created in `regionId` (DESIGN §4.2): the region's own defaults, else the map's
 * defaults for region-less hexes, else `fallback` (the painter's current terrain brush).
 */
export function hexDefaultsFor(map: MapData, regionId: string | null, fallback: HexDefaults): HexDefaults {
  const region = regionId ? map.regions[regionId] : undefined;
  const d = region?.defaults ?? map.defaults ?? fallback;
  return { terrain: d.terrain, difficulty: d.difficulty, tags: [...(d.tags ?? [])], encounterMod: d.encounterMod ?? 0 };
}

/**
 * Apply a brush to hexes, returning a new map. A brush that lands on an empty hex creates it, stamped with the
 * defaults of the region it is created in (region brush) or the map's (other brushes). Existing hexes keep their
 * values except what the brush sets.
 */
export function applyBrush(map: MapData, keys: HexKey[], op: BrushOp, defaults: HexDefaultsSource): MapData {
  const lookup = (regionId: string | null): HexDefaults =>
    typeof defaults === "function"
      ? defaults(regionId)
      : { terrain: defaults.terrain, difficulty: defaults.difficulty, tags: [...(defaults.tags ?? [])], encounterMod: defaults.encounterMod ?? 0 };
  const hexes = { ...map.hexes };
  for (const key of keys) {
    if (op.kind === "erase") {
      delete hexes[key];
      continue;
    }
    let prev = hexes[key];
    if (!prev) {
      const regionId = op.kind === "region" ? op.regionId : null;
      const d = lookup(regionId);
      prev = { key, terrain: d.terrain, difficulty: d.difficulty, region: null, tags: d.tags, ...(d.encounterMod ? { encounterMod: d.encounterMod } : {}) };
    }
    const next: HexRecord = { ...prev, tags: [...prev.tags] };
    if (op.kind === "terrain") {
      next.terrain = op.terrain;
      next.difficulty = op.difficulty;
      if (op.encounterMod !== undefined && op.encounterMod !== null) next.encounterMod = op.encounterMod;
    } else if (op.kind === "region") {
      next.region = op.regionId;
    } else if (op.add) {
      if (!next.tags.includes(op.tag)) next.tags.push(op.tag);
    } else {
      next.tags = next.tags.filter((t) => t !== op.tag);
    }
    hexes[key] = next;
  }
  return { ...map, hexes };
}

/** Re-stamp every hex outside any region with the map's defaults (terrain, difficulty, tags, encounter mod). */
export function restampUnregioned(map: MapData): { map: MapData; count: number } {
  if (!map.defaults) return { map, count: 0 };
  const d = map.defaults;
  const hexes = { ...map.hexes };
  let count = 0;
  for (const [key, hex] of Object.entries(map.hexes)) {
    if (hex.region && map.regions[hex.region]) continue;
    hexes[key] = { ...hex, terrain: d.terrain, difficulty: d.difficulty, tags: [...d.tags], encounterMod: d.encounterMod };
    count++;
  }
  return { map: { ...map, hexes }, count };
}

/**
 * Click-to-extend for route and path drafting: clicking the last hex removes it,
 * an adjacent hex is appended, anything else is rejected.
 */
export function extendPath(
  from: HexKey,
  path: HexKey[],
  key: HexKey,
  adjacent: (a: HexKey, b: HexKey) => boolean,
): { path: HexKey[]; error?: string } {
  const last = path.length ? path[path.length - 1] : from;
  if (key === last) return { path: path.slice(0, -1) };
  if (key === from || path.includes(key)) return { path, error: "That hex is already on the path." };
  if (!adjacent(last, key)) return { path, error: "Each hex must be adjacent to the previous one." };
  return { path: [...path, key] };
}

/** "navigator:2, *:-1" -> { navigator: 2, "*": -1 }. Throws on a malformed entry. */
export function parseDcMods(text: string): Record<string, number> {
  const mods: Record<string, number> = {};
  for (const part of text.split(/[,\n]/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^([^:\s]+)\s*:\s*([+-]?\d+)$/.exec(part);
    if (!m) throw new Error(`Bad DC modifier "${part}" (use role:mod, "*" for all roles).`);
    mods[m[1]] = Number(m[2]);
  }
  return mods;
}

export function formatDcMods(mods: Record<string, number>): string {
  return Object.entries(mods)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");
}

const SUPPLY = ["rations", "water"];
const TRACKS = ["rations", "water", "wagon"];
const KNOWLEDGE: KnowledgeState[] = ["unknown", "explored", "mapped"];
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown) => typeof v === "string" && v.length > 0;

function parseArray(text: string, what: string): unknown[] {
  if (!text.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`${what}: invalid JSON (${(err as Error).message}).`);
  }
  if (!Array.isArray(value)) throw new Error(`${what}: must be a JSON array.`);
  return value;
}

function validEffect(e: any): boolean {
  switch (e?.type) {
    case "replenish":
      return (SUPPLY.includes(e.track) || e.track === "either") && isNum(e.amount);
    case "extraDrain":
      return TRACKS.includes(e.track) && isNum(e.perDay);
    case "dcMod":
      return isStr(e.roleId) && isNum(e.mod);
    case "setMapState":
      return KNOWLEDGE.includes(e.state);
    default:
      return false;
  }
}

function validPrompt(p: any): boolean {
  const w = p?.when;
  const whenOk =
    ((w?.kind === "roleSuccess" || w?.kind === "roleFailure") && isStr(w.roleId)) ||
    (w?.kind === "day" && Number.isInteger(w.day) && w.day >= 1);
  return whenOk && isStr(p.text);
}

export function parseEffects(text: string): RouteEffect[] {
  const arr = parseArray(text, "Effects");
  arr.forEach((e, n) => {
    if (!validEffect(e)) throw new Error(`Effects: entry ${n + 1} is not a valid route effect.`);
  });
  return arr as RouteEffect[];
}

export function parsePrompts(text: string): GmPrompt[] {
  const arr = parseArray(text, "GM prompts");
  arr.forEach((p, n) => {
    if (!validPrompt(p)) throw new Error(`GM prompts: entry ${n + 1} needs a valid "when" and "text".`);
  });
  return arr as GmPrompt[];
}

/** "#rrggbb" / "#rgb" -> 0xrrggbb; anything else -> fallback. */
/**
 * Parse "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa" into a PIXI colour number and an alpha in [0, 1]
 * (opaque when the colour has no alpha). Anything else gives `fallback`, opaque.
 */
export function parseColor(color: string | null | undefined, fallback = 0x888888): { rgb: number; alpha: number } {
  let hex = (color ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3,4}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
  if (/^[0-9a-f]{6}$/i.test(hex)) return { rgb: parseInt(hex, 16), alpha: 1 };
  if (/^[0-9a-f]{8}$/i.test(hex)) return { rgb: parseInt(hex.slice(0, 6), 16), alpha: parseInt(hex.slice(6), 16) / 255 };
  return { rgb: fallback, alpha: 1 };
}

export function colorToNumber(color: string | null | undefined, fallback = 0x888888): number {
  return parseColor(color, fallback).rgb;
}

/** The colour's own alpha (1 when it has none). */
export function colorAlpha(color: string | null | undefined): number {
  return parseColor(color).alpha;
}

/** Split a colour into what a colour picker shows ("#rrggbb") and an opacity in [0, 1]. */
export function splitColor(color: string | null | undefined, fallback = "#888888"): { hex: string; alpha: number } {
  const { rgb, alpha } = parseColor(color, parseColor(fallback).rgb);
  return { hex: `#${rgb.toString(16).padStart(6, "0")}`, alpha };
}

/** Join a picker value and an opacity in [0, 1]: "#rrggbb" when opaque, else "#rrggbbaa". */
export function joinColor(hex: string, alpha: number): string {
  const base = splitColor(hex).hex;
  const a = Math.round(Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 1)) * 255);
  return a >= 255 ? base : `${base}${a.toString(16).padStart(2, "0")}`;
}

/** Flat [x, y, ...] polygon of a star. */
export function starPoints(cx: number, cy: number, outer: number, inner: number, points = 5): number[] {
  const out: number[] = [];
  for (let n = 0; n < points * 2; n++) {
    const r = n % 2 ? inner : outer;
    const a = -Math.PI / 2 + (n * Math.PI) / points;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

type Pt = { x: number; y: number };

/** Point halfway along a polyline, by length. */
export function polylineMidpoint(points: Pt[]): Pt {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const seg = points.slice(1).map((p, n) => Math.hypot(p.x - points[n].x, p.y - points[n].y));
  let remaining = seg.reduce((a, b) => a + b, 0) / 2;
  for (let n = 0; n < seg.length; n++) {
    if (remaining <= seg[n] || n === seg.length - 1) {
      const t = seg[n] ? Math.min(1, remaining / seg[n]) : 0;
      const a = points[n];
      const b = points[n + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= seg[n];
  }
  return points[points.length - 1];
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface HexInfo {
  title: string; // e.g. "Dunes · Hard"
  lines: string[]; // plain text; the tooltip escapes it
}

const TERRAIN_LABEL = (terrain: string) => terrain.charAt(0).toUpperCase() + terrain.slice(1);
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", standard: "Standard", hard: "Hard", brutal: "Brutal" };

/**
 * What the hover tooltip shows for one hex. `map` must already be the viewer's map: the full map for the GM,
 * `store.partyView()` for players (invariant 1). `gm` adds GM-only detail (party knowledge, region tuning).
 * Returns null when there is nothing to show (no record and no landmark/route/caravan on the hex).
 */
export function hexInfo(
  map: MapData,
  key: HexKey,
  opts: { gm: boolean; knowledge?: KnowledgeState; caravanHere?: boolean; terrainLabel?: (t: string) => string },
): HexInfo | null {
  const hex = map.hexes[key];
  const landmarks = Object.values(map.landmarks).filter((l) => l.hex === key);
  const routes = Object.values(map.routes).filter((r) => r.from === key || r.hexes.includes(key));
  if (!hex && !landmarks.length && !routes.length && !opts.caravanHere) return null;

  const label = opts.terrainLabel ?? TERRAIN_LABEL;
  const title = hex ? `${label(hex.terrain)} · ${DIFFICULTY_LABEL[hex.difficulty] ?? hex.difficulty}` : "Uncharted";
  const lines: string[] = [];
  for (const l of landmarks) lines.push(`Landmark: ${l.name}${opts.gm && !l.knownToParty ? " (hidden)" : ""}`);
  if (opts.caravanHere) lines.push("The caravan is here");
  const region = hex?.region ? map.regions[hex.region] : undefined;
  if (region) {
    let text = `Region: ${region.name}`;
    if (opts.gm) {
      const mods = Object.entries(region.dcMods ?? {}).map(([k, v]) => `${k === "*" ? "all" : k} ${v >= 0 ? "+" : ""}${v}`);
      if (mods.length) text += ` (DC ${mods.join(", ")})`;
      if (region.waterMultiplier && region.waterMultiplier !== 1) text += ` · water ×${region.waterMultiplier}`;
      text += region.encounterTable ? " · encounter table set" : " · no encounter table";
    }
    lines.push(text);
  }
  if (hex?.tags.length) lines.push(`Tags: ${hex.tags.join(", ")}`);
  if (hex?.encounterMod) lines.push(`Encounter ${hex.encounterMod > 0 ? "+" : ""}${hex.encounterMod}`);
  for (const r of routes) lines.push(`Route: ${routeLabel(r)} (${r.days} d, ${DIFFICULTY_LABEL[r.difficulty] ?? r.difficulty})${opts.gm && !r.knownToParty ? " · hidden" : ""}`);
  if (opts.gm) lines.push(`Party knows: ${opts.knowledge ?? "unknown"}`);
  return { title, lines };
}

/** Default border colour for hexes outside any region (a map can override it with `baseColor`). */
export const DEFAULT_BASE_COLOR = "#888888";

export type BorderKind = "base" | "region" | "double";

export interface BorderSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  kind: BorderKind;
}

/**
 * Hex borders drawn edge by edge (no polygon outlines, so neighbours never overdraw each other):
 * - an edge between two hexes of the same region (or two region-less hexes) is drawn once, in that colour;
 * - a region hex's colour wins over a region-less neighbour (or the map edge);
 * - an edge between two different regions is drawn twice, each region's colour inset into its own hex (a
 *   double line). `inset` is in pixels.
 * `verticesOf` gives a hex's corner points in order; `neighbourAt` maps a point to the hex key under it.
 */
export function borderSegments(
  map: MapData,
  geometry: { verticesOf: (key: HexKey) => Pt[]; centerOf: (key: HexKey) => Pt; neighbourAt: (p: Pt) => HexKey },
  inset: number,
): BorderSegment[] {
  const base = map.baseColor || DEFAULT_BASE_COLOR;
  const regionOf = (key: HexKey) => {
    const id = map.hexes[key]?.region;
    return id && map.regions[id] ? id : null;
  };
  const out: BorderSegment[] = [];
  for (const key of Object.keys(map.hexes)) {
    const v = geometry.verticesOf(key);
    const c = geometry.centerOf(key);
    const mine = regionOf(key);
    for (let k = 0; k < v.length; k++) {
      const a = v[k];
      const b = v[(k + 1) % v.length];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const across = geometry.neighbourAt({ x: mid.x + (mid.x - c.x) * 0.3, y: mid.y + (mid.y - c.y) * 0.3 });
      const exists = across !== key && !!map.hexes[across];
      const theirs = exists ? regionOf(across) : null;
      const once = !exists || key < across; // shared edges between like hexes are drawn by one side only

      if (mine && theirs && mine !== theirs) {
        const p = toward(a, c, inset);
        const q = toward(b, c, inset);
        out.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, color: map.regions[mine].color, kind: "double" });
      } else if (mine) {
        if (theirs === mine && !once) continue;
        out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: map.regions[mine].color, kind: "region" });
      } else if (!theirs && once) {
        out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: base, kind: "base" });
      }
    }
  }
  return out;
}

function toward(p: Pt, c: Pt, d: number): Pt {
  const dx = c.x - p.x;
  const dy = c.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: p.x + (dx / len) * d, y: p.y + (dy / len) * d };
}

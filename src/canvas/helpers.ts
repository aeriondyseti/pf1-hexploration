// Pure helpers for the canvas layer and painter (no Foundry globals; unit-tested).
import type { Difficulty, GmPrompt, HexKey, HexRecord, KnowledgeState, MapData, RouteEffect } from "../types";

export const DIFFICULTY_LETTER: Record<Difficulty, string> = { easy: "E", standard: "S", hard: "H", brutal: "B" };

export const TAG_GLYPH: Record<string, string> = {
  difficult: "▲",
  feature: "◆",
  "hunting-ground": "✦",
  resource: "●",
  secret: "?",
  standard: "■",
};

export function hexKey(o: { i: number; j: number }): HexKey {
  return `${o.i},${o.j}`;
}

export function parseHexKey(key: HexKey): { i: number; j: number } {
  const [i, j] = key.split(",").map(Number);
  return { i, j };
}

export type BrushOp =
  | { kind: "terrain"; terrain: string; difficulty: Difficulty }
  | { kind: "region"; regionId: string | null }
  | { kind: "tag"; tag: string; add: boolean }
  | { kind: "erase" };

/** Apply a brush to hexes, returning a new map. Region/tag brushes create a hex from `fallback` if none exists. */
export function applyBrush(
  map: MapData,
  keys: HexKey[],
  op: BrushOp,
  fallback: { terrain: string; difficulty: Difficulty },
): MapData {
  const hexes = { ...map.hexes };
  for (const key of keys) {
    if (op.kind === "erase") {
      delete hexes[key];
      continue;
    }
    const prev: HexRecord = hexes[key] ?? { key, ...fallback, region: null, tags: [] };
    const next: HexRecord = { ...prev, tags: [...prev.tags] };
    if (op.kind === "terrain") {
      next.terrain = op.terrain;
      next.difficulty = op.difficulty;
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
export function colorToNumber(color: string | null | undefined, fallback = 0x888888): number {
  if (!color) return fallback;
  let hex = color.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : fallback;
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

/** Dash segments [x1, y1, x2, y2] along a line (PIXI v7 has no native dashed stroke). */
export function dashSegments(a: Pt, b: Pt, dash: number, gap: number): [number, number, number, number][] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!len) return [];
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const out: [number, number, number, number][] = [];
  for (let s = 0; s < len; s += dash + gap) {
    const e = Math.min(len, s + dash);
    out.push([a.x + ux * s, a.y + uy * s, a.x + ux * e, a.y + uy * e]);
  }
  return out;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

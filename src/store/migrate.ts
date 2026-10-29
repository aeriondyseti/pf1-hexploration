// 0.1.x map data -> the MVP rework format (DESIGN §4.2 "Existing maps migrate"). Pure; unit-tested.
import {
  TERRAIN_RULES,
  UC_TAGS,
  type HexDefaults,
  type HexRecord,
  type Landmark,
  type MapData,
  type Region,
  type Route,
  type Terrain,
  type TravelRules,
  type UcTag,
} from "../types";

export const MAP_VERSION = 2;

/** Old terrain label -> new terrain, plus any element the old label implied. */
const TERRAIN_MAP: Record<string, { terrain: Terrain; tag?: UcTag }> = {
  dunes: { terrain: "desert-sandy" },
  desert: { terrain: "desert-sandy" },
  badlands: { terrain: "desert-rocky" },
  canyon: { terrain: "mountains", tag: "difficult" },
  scrubland: { terrain: "plains" },
  oasis: { terrain: "plains", tag: "resource" },
  marsh: { terrain: "swamp" },
  urban: { terrain: "settlement" },
  road: { terrain: "plains" },
  mountain: { terrain: "mountains" },
};

/** Map an old (or current) terrain label to the §4.2 list; unknown labels become plains. */
export function migrateTerrain(raw: unknown): { terrain: Terrain; tag?: UcTag } {
  const label = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (label in TERRAIN_RULES) return { terrain: label as Terrain };
  return TERRAIN_MAP[label] ?? { terrain: "plains" };
}

const isUcTag = (t: unknown): t is UcTag => typeof t === "string" && (UC_TAGS as readonly string[]).includes(t);

function migrateTags(raw: unknown, extra?: UcTag): UcTag[] {
  const tags = Array.isArray(raw) ? raw.filter(isUcTag) : [];
  if (extra) tags.push(extra);
  return [...new Set(tags)];
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function migrateDefaults(raw: any): HexDefaults | undefined {
  if (!raw || typeof raw !== "object" || !raw.terrain) return undefined;
  const t = migrateTerrain(raw.terrain);
  return { terrain: t.terrain, tags: migrateTags(raw.tags, t.tag) };
}

function migrateDcMods(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function migrateRules(raw: any): TravelRules {
  return {
    encounterTable: typeof raw?.encounterTable === "string" && raw.encounterTable ? raw.encounterTable : null,
    dcMods: migrateDcMods(raw?.dcMods),
    rationsMultiplier: num(raw?.rationsMultiplier, 1),
    waterMultiplier: num(raw?.waterMultiplier, 1),
  };
}

function migrateHex(key: string, raw: any): HexRecord {
  const t = migrateTerrain(raw?.terrain);
  return {
    key: typeof raw?.key === "string" ? raw.key : key,
    terrain: t.terrain,
    region: typeof raw?.region === "string" && raw.region ? raw.region : null,
    tags: migrateTags(raw?.tags, t.tag),
  };
}

function migrateRegion(id: string, raw: any): Region {
  const region: Region = {
    id: typeof raw?.id === "string" ? raw.id : id,
    name: String(raw?.name ?? id),
    color: typeof raw?.color === "string" ? raw.color : "#cc3333",
    ...migrateRules(raw),
  };
  const defaults = migrateDefaults(raw?.defaults);
  if (defaults) region.defaults = defaults;
  return region;
}

function migrateRoute(id: string, raw: any): Route {
  const route: Route = {
    id: typeof raw?.id === "string" ? raw.id : id,
    name: String(raw?.name ?? ""),
    from: String(raw?.from ?? ""),
    hexes: Array.isArray(raw?.hexes) ? raw.hexes.map(String) : [],
    kind: raw?.kind === "highway" ? "highway" : "road",
    knownToParty: !!raw?.knownToParty,
  };
  if (typeof raw?.color === "string" && raw.color) route.color = raw.color;
  return route;
}

function migrateLandmark(id: string, raw: any): Landmark {
  const lm: Landmark = {
    id: typeof raw?.id === "string" ? raw.id : id,
    name: String(raw?.name ?? ""),
    hex: String(raw?.hex ?? ""),
    description: String(raw?.description ?? ""),
    knownToParty: !!raw?.knownToParty,
  };
  if (typeof raw?.icon === "string" && raw.icon) lm.icon = raw.icon;
  return lm;
}

const entries = (raw: unknown): [string, any][] => (raw && typeof raw === "object" ? Object.entries(raw) : []);

/**
 * Convert saved map data of any older format to version 2. Drops difficulty, encounter mods, custom tags, storm
 * thresholds and route days/difficulty/encounter bonus/bargain/effects/prompts; maps old terrain labels (§4.2).
 * Also safe on version-2 data (it only normalises).
 */
export function migrateMap(raw: any): MapData {
  const map: MapData = {
    hexes: Object.fromEntries(entries(raw?.hexes).map(([k, v]) => [k, migrateHex(k, v)])),
    regions: Object.fromEntries(entries(raw?.regions).map(([k, v]) => [k, migrateRegion(k, v)])),
    landmarks: Object.fromEntries(entries(raw?.landmarks).map(([k, v]) => [k, migrateLandmark(k, v)])),
    routes: Object.fromEntries(entries(raw?.routes).map(([k, v]) => [k, migrateRoute(k, v)])),
    version: MAP_VERSION,
  };
  if (typeof raw?.baseColor === "string" && raw.baseColor) map.baseColor = raw.baseColor;
  const defaults = migrateDefaults(raw?.defaults);
  if (defaults) map.defaults = defaults;
  if (raw?.rules && typeof raw.rules === "object") map.rules = migrateRules(raw.rules);
  return map;
}

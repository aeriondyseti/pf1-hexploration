// Pure rules engine (invariant 3): no Foundry or pf1 globals, only domain data and an injected roller.
// DESIGN §4.2 and §4.5–§4.11 (MVP rework, ADR-0008).
import type { EngineApi, Roller } from "../contracts";
import {
  ROLE_DEFS,
  TERRAIN_RULES,
  type CaravanSettings,
  type CheckResult,
  type CheckSpec,
  type DayContext,
  type DayOutcome,
  type DayPreview,
  type ExploreClass,
  type HexKey,
  type KnowledgeState,
  type MapData,
  type Pace,
  type RoleId,
  type RouteKind,
  type SupplyTrack,
  type Terrain,
  type TravelRules,
  type UcTag,
} from "../types";

/** Default caravan settings (not part of EngineApi; exported for the store). */
export const DEFAULT_SETTINGS: CaravanSettings = { doublingPenalty: 4 };
const DEFAULT_RULES: TravelRules = { encounterTable: null, dcMods: {}, rationsMultiplier: 1, waterMultiplier: 1 };
const KNOWLEDGE_RANK: Record<KnowledgeState, number> = { unknown: 0, explored: 1, mapped: 2 };
/** CRB overland speed categories, miles/day (10/15/20/30/40/50 ft). */
const SPEEDS = [8, 12, 16, 24, 32, 40];
const SPEED_FT = [10, 15, 20, 30, 40, 50];
const HEX_MILES = 12;
const REPAIR_COST = 1000; // cp (10 gp)
const IMPASSABLE = "the way is impassable";
// Guards against float noise such as 0.1 * 30 = 3.0000000000000004.
const floor = (x: number) => Math.floor(x + 1e-9);

// ---------- Map lookups ----------

function terrainOf(map: MapData, hex: HexKey): Terrain {
  return map.hexes[hex]?.terrain ?? "plains";
}

function tagsOf(map: MapData, hex: HexKey): UcTag[] {
  return map.hexes[hex]?.tags ?? [];
}

function hasTag(map: MapData, hex: HexKey, tag: UcTag): boolean {
  return tagsOf(map, hex).includes(tag);
}

function rulesFor(map: MapData, hex: HexKey): TravelRules {
  const regionId = map.hexes[hex]?.region;
  const src: Partial<TravelRules> = (regionId ? map.regions[regionId] : undefined) ?? map.rules ?? DEFAULT_RULES;
  return {
    encounterTable: src.encounterTable ?? null,
    dcMods: { ...(src.dcMods ?? {}) },
    rationsMultiplier: src.rationsMultiplier ?? 1,
    waterMultiplier: src.waterMultiplier ?? 1,
  };
}

// ---------- Speed ----------

/** One speed category slower (CRB heavy load / Difficult). Never faster than the input. */
function slower(miles: number): number {
  let i = -1;
  for (let k = 0; k < SPEEDS.length; k++) if (SPEEDS[k] <= miles) i = k;
  if (i < 0) return miles; // below the slowest category: nothing slower to step to
  return SPEEDS[Math.max(0, i - 1)];
}

function walkerMiles(ft: number): number {
  const idx = SPEED_FT.indexOf(ft);
  return idx >= 0 ? SPEEDS[idx] : Math.round(ft * 0.8);
}

function vehicleBlock(v: DayContext["vehicles"][number]): string | null {
  if (v.driver === null) return `${v.name} has no driver`;
  if (v.teamStrength < v.teamRequired) return `${v.name} is short of draft animals`;
  // maxHp 0 = HP unknown (unreadable or unset on the pf1 vehicle): never wrecked or broken.
  if (v.maxHp > 0 && v.hp <= 0) return `${v.name} is wrecked`;
  if (v.cargo > 2 * v.cargoCapacity) return `${v.name} is overloaded`;
  return null;
}

function pace(ctx: DayContext): Pace {
  let best: { miles: number; name: string } | null = null;
  let blocked: string | null = null;
  const consider = (miles: number, name: string) => {
    if (best === null || miles < best.miles) best = { miles, name };
  };
  for (const v of ctx.vehicles) {
    blocked ??= vehicleBlock(v);
    let miles = v.milesPerDay;
    if (v.maxHp > 0 && v.hp < v.maxHp / 2) miles = miles / 2; // broken: more than half HP lost (UCombat)
    if (v.cargo > v.cargoCapacity) miles = slower(miles);
    consider(miles, v.name);
  }
  for (const w of ctx.walkers) consider(walkerMiles(w.landSpeed), w.name);
  const b = best as { miles: number; name: string } | null;
  return b ? { milesPerDay: b.miles, setBy: b.name, blocked } : { milesPerDay: 24, setBy: "default", blocked };
}

// ---------- Course ----------

/** The route kind of the step a → b, or null (trackless). Highways win over roads. */
function roadKind(map: MapData, a: HexKey, b: HexKey): RouteKind | null {
  let kind: RouteKind | null = null;
  for (const route of Object.values(map.routes)) {
    const chain = [route.from, ...route.hexes];
    for (let i = 0; i + 1 < chain.length; i++) {
      if ((chain[i] === a && chain[i + 1] === b) || (chain[i] === b && chain[i + 1] === a)) {
        if (route.kind === "highway") return "highway";
        kind = "road";
      }
    }
  }
  return kind;
}

function passable(map: MapData, hex: HexKey): boolean {
  return TERRAIN_RULES[terrainOf(map, hex)].passable;
}

/** Hexes entered today (Navigator succeeding) and whether every step is on a route. */
function moveToday(ctx: DayContext, paceMiles: number): { hexes: HexKey[]; road: boolean; blocked: string | null } {
  const { map, course, position } = ctx;
  if (course.length === 0) return { hexes: [], road: false, blocked: null };
  const first = course[0];
  if (!passable(map, first)) return { hexes: [], road: false, blocked: IMPASSABLE };
  const kind = roadKind(map, position, first);
  const rule = TERRAIN_RULES[terrainOf(map, first)];
  const mult = kind === "highway" ? rule.highway : kind === "road" ? rule.road : rule.trackless;
  const miles = hasTag(map, first, "difficult") ? slower(paceMiles) : paceMiles;
  const n = Math.min(course.length, Math.max(1, floor((miles * mult) / HEX_MILES)));
  const hexes: HexKey[] = [];
  let road = true;
  let prev = position;
  for (let i = 0; i < n; i++) {
    const hex = course[i];
    if (!passable(map, hex)) break;
    if (roadKind(map, prev, hex) === null) road = false;
    hexes.push(hex);
    prev = hex;
  }
  return { hexes, road, blocked: null };
}

// ---------- Checks ----------

function driverStep(trackless: number): number {
  if (trackless >= 1) return 0;
  if (trackless >= 0.75) return 1;
  if (trackless >= 0.5) return 2;
  return 3;
}

function buildChecks(ctx: DayContext, moving: boolean, road: boolean, dcHex: HexKey): CheckSpec[] {
  const { map, settings } = ctx;
  const rules = rulesFor(map, dcHex);
  const terrain = terrainOf(map, dcHex);
  const tr = TERRAIN_RULES[terrain];
  const difficult = hasTag(map, dcHex, "difficult");
  const mod = (roleId: RoleId | "driver") => (rules.dcMods["*"] ?? 0) + (rules.dcMods[roleId] ?? 0);
  const penaltyFor = (actor: string | null) => (actor && (ctx.rolesHeld[actor] ?? 0) >= 2 ? settings.doublingPenalty : 0);

  const make = (
    id: string,
    roleId: RoleId | "driver",
    label: string,
    actorUuid: string | null,
    dc: number,
    auto = false,
    bonus = 0,
  ): CheckSpec => ({
    id,
    roleId,
    label,
    actorUuid,
    skills: [...ROLE_DEFS[roleId].skills],
    dc: dc + mod(roleId),
    penalty: auto ? 0 : penaltyFor(actorUuid),
    bonus: auto ? 0 : bonus,
    auto,
  });
  const role = (id: RoleId) => ctx.roles[id] ?? null;

  const checks: CheckSpec[] = [];
  if (moving) {
    const nav = role("navigator");
    const mapped = ctx.knowledge[dcHex] === "mapped" ? 4 : 0;
    checks.push(make("navigator", "navigator", ROLE_DEFS.navigator.name, nav, (tr.lostDc ?? 14) + 4, road, mapped));
    const driverDc = 5 + 5 * driverStep(tr.trackless) + (difficult ? 5 : 0);
    for (const v of ctx.vehicles) {
      checks.push(make(`driver:${v.actorUuid}`, "driver", `${ROLE_DEFS.driver.name} (${v.name})`, v.driver, driverDc, road));
    }
  }
  checks.push(make("scout", "scout", ROLE_DEFS.scout.name, role("scout"), 18));
  const eaters = ctx.eaters.filter((e) => e.food > 0).length;
  let foragerDc = 10 + 2 * Math.max(0, eaters - 1);
  if (terrain === "desert-sandy") foragerDc += 10;
  if (hasTag(map, dcHex, "resource")) foragerDc -= 2;
  checks.push(make("forager", "forager", ROLE_DEFS.forager.name, role("forager"), foragerDc));
  if (moving || ctx.activity === "rest") {
    checks.push(make("wainwright", "wainwright", ROLE_DEFS.wainwright.name, role("wainwright"), moving ? 15 : 10));
  }
  if (moving) checks.push(make("cartographer", "cartographer", ROLE_DEFS.cartographer.name, role("cartographer"), 15));
  checks.push(make("healer", "healer", ROLE_DEFS.healer.name, role("healer"), 15));
  return checks;
}

// ---------- Preview ----------

function preview(ctx: DayContext): DayPreview & { dcHex: HexKey } {
  const p = pace(ctx);
  const travelling = ctx.activity === "travel" && ctx.course.length > 0;
  let blocked = p.blocked;
  let hexes: HexKey[] = [];
  let road = false;
  if (travelling && !blocked) {
    const m = moveToday(ctx, p.milesPerDay);
    blocked = m.blocked;
    hexes = m.hexes;
    road = m.road;
  }
  const moving = travelling && !blocked && hexes.length > 0;
  if (!moving) {
    hexes = [];
    road = false;
  }
  const dcHex = moving ? hexes[0] : ctx.position;
  return {
    moving,
    pace: travelling ? { ...p, blocked } : p,
    hexes,
    road,
    checks: buildChecks(ctx, moving, road, dcHex),
    dcHex,
  };
}

function dayPreview(ctx: DayContext): DayPreview {
  const { dcHex: _dcHex, ...rest } = preview(ctx);
  return rest;
}

// ---------- Exploration (UC) ----------

const EXPLORE_TABLE: Record<number, Record<ExploreClass, number>> = {
  10: { plain: 3, desert: 4, mountain: 5 },
  15: { plain: 3, desert: 4, mountain: 5 },
  20: { plain: 2, desert: 3, mountain: 4 },
  30: { plain: 1, desert: 2, mountain: 3 },
  40: { plain: 1, desert: 1, mountain: 2 },
  50: { plain: 1, desert: 1, mountain: 1 },
};

function paceFeet(miles: number): number {
  let ft = SPEED_FT[0];
  for (let i = 0; i < SPEEDS.length; i++) if (miles >= SPEEDS[i]) ft = SPEED_FT[i];
  return ft;
}

function exploreDaysNeeded(map: MapData, hex: HexKey, milesPerDay: number): number {
  const days = EXPLORE_TABLE[paceFeet(milesPerDay)][TERRAIN_RULES[terrainOf(map, hex)].explore];
  return hasTag(map, hex, "secret") ? Math.ceil(days * 1.5) : days;
}

// ---------- Resolve ----------

function resolveDay(ctx: DayContext, totals: Record<string, number | null>, roller: Roller): DayOutcome {
  const pv = preview(ctx);
  const { map } = ctx;

  const checks: CheckResult[] = pv.checks.map((c) => {
    if (c.auto) return { ...c, total: null, success: true };
    if (c.actorUuid === null) return { ...c, total: null, success: false };
    const raw = totals[c.id];
    if (raw === null || raw === undefined) return { ...c, total: null, success: false };
    const total = raw - c.penalty + c.bonus;
    return { ...c, total, success: total >= c.dc };
  });
  const result = (id: string) => checks.find((c) => c.id === id);
  const ok = (id: string) => result(id)?.success ?? false;

  const lost = pv.moving && !ok("navigator");
  const moved = pv.moving && !lost ? [...pv.hexes] : [];
  const end = moved.length ? moved[moved.length - 1] : ctx.position;

  // Knowledge: only states that raise what the party knows.
  const knowledge: Record<HexKey, KnowledgeState> = {};
  const raise = (hex: HexKey, state: KnowledgeState) => {
    const current = knowledge[hex] ?? ctx.knowledge[hex] ?? "unknown";
    if (KNOWLEDGE_RANK[state] > KNOWLEDGE_RANK[current]) knowledge[hex] = state;
  };
  if (pv.moving && moved.length) {
    const state: KnowledgeState = ok("cartographer") ? "mapped" : "explored";
    for (const hex of moved) raise(hex, state);
  }

  // Supplies.
  const endRules = rulesFor(map, end);
  let rations = ctx.eaters.reduce((s, e) => s + e.food, 0) * endRules.rationsMultiplier;
  let water = ctx.eaters.reduce((s, e) => s + e.water, 0) * endRules.waterMultiplier;
  const preserved: SupplyTrack[] = [];
  if (ok("forager")) {
    if (ctx.activity === "forage") preserved.push("rations", "water");
    else {
      const rDays = rations > 0 ? ctx.stock.rations / rations : Infinity;
      const wDays = water > 0 ? ctx.stock.water / water : Infinity;
      preserved.push(rDays < wDays ? "rations" : "water");
    }
  }
  if (preserved.includes("rations")) rations = 0;
  if (preserved.includes("water")) water = 0;
  const wages = ctx.eaters.reduce((s, e) => s + e.wage, 0);

  // Wear (dice before the encounter d20, vehicles in order).
  const wear: DayOutcome["wear"] = [];
  const wearCancelled = pv.moving && ok("wainwright");
  if (moved.length && !pv.road && !wearCancelled) {
    let die = TERRAIN_RULES[terrainOf(map, end)].wearDie;
    if (die > 0) {
      if (hasTag(map, end, "difficult")) die = Math.min(10, die + 2);
      for (const v of ctx.vehicles) {
        const count = 1 + (ok(`driver:${v.actorUuid}`) ? 0 : 1);
        let damage = 0;
        for (let i = 0; i < count; i++) damage += roller.die(die);
        wear.push({ vehicleUuid: v.actorUuid, dice: `${count}d${die}`, damage });
      }
    }
  }

  // Rest-day repair: hp is the HP restored.
  let repair: DayOutcome["repair"] = null;
  const wain = result("wainwright");
  if (ctx.activity === "rest" && wain && wain.actorUuid !== null && ctx.repairStock >= REPAIR_COST) {
    let target: DayContext["vehicles"][number] | null = null;
    for (const v of ctx.vehicles) {
      const missing = v.maxHp - v.hp;
      if (missing > 0 && (target === null || missing > target.maxHp - target.hp)) target = v;
    }
    if (target) {
      const hp = Math.min(wain.success ? 10 : 5, target.maxHp - target.hp);
      repair = { vehicleUuid: target.actorUuid, hp, cost: REPAIR_COST };
    }
  }

  // Exploration.
  let exploreNeeded = 0;
  let revealed: HexKey | null = null;
  if (ctx.activity === "explore") {
    exploreNeeded = exploreDaysNeeded(map, ctx.position, pv.pace.milesPerDay);
    if (ctx.exploreDays + 1 >= exploreNeeded) {
      revealed = ctx.position;
      raise(ctx.position, "mapped");
    }
  }

  // Encounter.
  const d20 = roller.d20();
  const bonus = ctx.tripDay + (hasTag(map, end, "hunting-ground") ? 2 : 0);
  const encounter = { d20, bonus, total: d20 + bonus, table: endRules.encounterTable };

  let done: boolean;
  switch (ctx.activity) {
    case "travel":
      if (ctx.course.length === 0) done = true;
      else if (lost || !pv.moving) done = false;
      else done = moved.length === ctx.course.length;
      break;
    case "explore":
      done = revealed !== null;
      break;
    default:
      done = true;
  }

  return {
    checks,
    pace: pv.pace,
    moved,
    lost,
    end,
    drain: { rations, water },
    preserved,
    wages,
    wear,
    repair,
    knowledge,
    revealed,
    exploreDaysNeeded: exploreNeeded,
    encounter,
    surprised: !ok("scout"),
    longTermCare: ok("healer"),
    done,
  };
}

// ---------- Grid & dice ----------

/** Foundry offset {i: row, j: column} to cube coordinates, matching HexagonalGrid's offset rules. */
function offsetToCube(key: HexKey, columns: boolean, even: boolean) {
  const [i, j] = key.split(",").map(Number);
  let q: number;
  let r: number;
  if (columns) {
    q = j;
    r = even ? i - ((j + (j & 1)) >> 1) : i - ((j - (j & 1)) >> 1);
  } else {
    q = even ? j - ((i + (i & 1)) >> 1) : j - ((i - (i & 1)) >> 1);
    r = i;
  }
  return { q, r, s: -q - r };
}

function hexAdjacent(a: HexKey, b: HexKey, columns: boolean, even: boolean): boolean {
  const ca = offsetToCube(a, columns, even);
  const cb = offsetToCube(b, columns, even);
  const dist = (Math.abs(ca.q - cb.q) + Math.abs(ca.r - cb.r) + Math.abs(ca.s - cb.s)) / 2;
  return dist === 1;
}

function seededRoller(seed: number): Roller {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const die = (sides: number) => Math.floor(next() * sides) + 1;
  return { d20: () => die(20), die };
}

export const engine = {
  rulesFor,
  pace,
  dayPreview,
  resolveDay,
  exploreDaysNeeded,
  hexAdjacent,
  seededRoller,
} satisfies EngineApi;

// Pure rules engine (invariant 3): no Foundry or pf1 globals, only domain data and an injected roller.
import type { EngineApi, ResolveLegInput, Roller } from "../contracts";
import {
  DIFFICULTIES,
  ENCOUNTER_BONUS,
  WAGON_DRAIN,
  type Assignment,
  type CaravanSettings,
  type DayPlan,
  type Difficulty,
  type HexKey,
  type HexRecord,
  type KnowledgeState,
  type LegOutcome,
  type LegPlan,
  type MapData,
  type Region,
  type RoleDef,
  type RoleEffect,
  type RoleOutcome,
  type RosterMember,
} from "../types";

const DEFAULT_ROLES: RoleDef[] = [
  {
    id: "navigator",
    name: "Navigator",
    skills: ["sur", "pro"],
    baseDc: 18,
    dcFormula: "fixed",
    success: [],
    failure: [{ type: "addDays", days: 1 }],
    vacant: [{ type: "addDays", days: 1 }],
  },
  {
    id: "scout",
    name: "Scout",
    skills: ["per", "pro"],
    baseDc: 18,
    dcFormula: "fixed",
    success: [{ type: "surprise", surprised: false }],
    failure: [{ type: "surprise", surprised: true }],
    vacant: [{ type: "surprise", surprised: true }],
  },
  {
    id: "forager",
    name: "Forager",
    skills: ["sur", "kna", "pro"],
    baseDc: 10,
    dcFormula: "forager",
    success: [{ type: "preserveOne" }],
    failure: [],
    vacant: [],
  },
  {
    id: "driver",
    name: "Driver",
    skills: ["han", "pro"],
    baseDc: 15,
    dcFormula: "fixed",
    success: [],
    failure: [{ type: "addDays", days: 1 }],
    vacant: [{ type: "addDays", days: 1 }],
  },
  {
    id: "wainwright",
    name: "Wainwright",
    skills: ["pro", "crf"],
    baseDc: 15,
    dcFormula: "fixed",
    success: [{ type: "wagonPerDay", delta: 1 }],
    failure: [{ type: "wagonPerDay", delta: -1 }],
    vacant: [{ type: "wagonPerDay", delta: -1 }],
  },
  {
    id: "cartographer",
    name: "Cartographer",
    skills: ["kge", "pro"],
    baseDc: 15,
    dcFormula: "fixed",
    success: [{ type: "setMapState", state: "mapped" }],
    failure: [{ type: "setMapState", state: "explored" }],
    vacant: [{ type: "setMapState", state: "explored" }],
  },
  {
    id: "healer",
    name: "Healer/Cook",
    skills: ["hea", "pro"],
    baseDc: 18,
    dcFormula: "fixed",
    success: [{ type: "rest" }],
    failure: [{ type: "forcedMarch" }],
    vacant: [{ type: "forcedMarch" }],
  },
];

const DEFAULT_SETTINGS: CaravanSettings = { doublingPenalty: 4, forcedMarchBaseDc: 10, forcedMarchStep: 2 };

const KNOWLEDGE_RANK: Record<KnowledgeState, number> = { unknown: 0, explored: 1, mapped: 2 };

// Guards against float noise such as 0.1 * 30 = 3.0000000000000004 rounding up a whole day.
const ceil = (x: number) => Math.ceil(x - 1e-9);

function consumption(roster: RosterMember[]) {
  return roster.reduce((acc, m) => ({ food: acc.food + m.food, water: acc.water + m.water }), { food: 0, water: 0 });
}

function eaters(roster: RosterMember[]): number {
  return roster.filter((m) => m.food > 0).length;
}

function roleDc(role: RoleDef, plan: LegPlan, regions: Record<string, Region>, roster: RosterMember[]): number {
  let dc = role.dcFormula === "forager" ? 10 + 2 * (eaters(roster) - 1) : role.baseDc;
  const region = plan.regionId ? regions[plan.regionId] : undefined;
  if (region) dc += (region.dcMods["*"] ?? 0) + (region.dcMods[role.id] ?? 0);
  for (const e of plan.effects) {
    if (e.type === "dcMod" && (e.roleId === role.id || e.roleId === "*")) dc += e.mod;
  }
  return dc;
}

/** roleDc plus the leg's hex adjustments (Forager -2 with a Resource hex on the path). Used by
 *  resolveLeg and by the muster UI so both show the same DC. */
export function legRoleDc(
  role: RoleDef,
  plan: LegPlan,
  hexes: Record<HexKey, HexRecord>,
  regions: Record<string, Region>,
  roster: RosterMember[],
): number {
  let dc = roleDc(role, plan, regions, roster);
  if (role.dcFormula === "forager" && plan.path.some((k) => hexes[k]?.tags.includes("resource"))) dc -= 2;
  return dc;
}

function rolesHeldBy(actorUuid: string, assignments: Assignment[]): string[] {
  return assignments.filter((a) => a.actorUuid === actorUuid).map((a) => a.roleId);
}

function doublingPenalty(actorUuid: string, assignments: Assignment[], settings: CaravanSettings): number {
  return rolesHeldBy(actorUuid, assignments).length >= 2 ? settings.doublingPenalty : 0;
}

function resolveLeg(input: ResolveLegInput): LegOutcome {
  const { plan, roles, assignments, rolls, roster, hexes, regions, settings } = input;

  // Role outcomes. The doubling penalty was already applied to the submitted total by the roller.
  const outcomes: RoleOutcome[] = [];
  const effects: RoleEffect[] = [];
  for (const role of roles) {
    const assignment = assignments.find((a) => a.roleId === role.id);
    const roll = assignment
      ? rolls.find((r) => r.roleId === role.id && r.actorUuid === assignment.actorUuid)
      : undefined;
    const dc = legRoleDc(role, plan, hexes, regions, roster);
    const total = roll ? roll.total : null;
    const success = total !== null && total >= dc;
    outcomes.push({
      roleId: role.id,
      actorUuid: assignment?.actorUuid ?? null,
      dc,
      total,
      success,
      doubled: assignment ? rolesHeldBy(assignment.actorUuid, assignments).length >= 2 : false,
    });
    effects.push(...(success ? role.success : assignment ? role.failure : role.vacant));
  }

  let addDays = 0;
  let surprised = false;
  let preserveOne = false;
  let wagonDelta = 0;
  let rest = false;
  let forcedMarchEffect = false;
  let mapState: KnowledgeState | null = null;
  const raiseMapState = (s: KnowledgeState) => {
    if (mapState === null || KNOWLEDGE_RANK[s] > KNOWLEDGE_RANK[mapState]) mapState = s;
  };
  for (const e of effects) {
    switch (e.type) {
      case "addDays": addDays += e.days; break;
      case "surprise": surprised = e.surprised; break;
      case "preserveOne": preserveOne = true; break;
      case "wagonPerDay": wagonDelta += e.delta; break;
      case "setMapState": raiseMapState(e.state); break;
      case "rest": rest = true; break;
      case "forcedMarch": forcedMarchEffect = true; break;
    }
  }
  // A route may also set the map state on arrival; knowledge never goes down, so the higher one wins.
  for (const e of plan.effects) if (e.type === "setMapState") raiseMapState(e.state);
  const forcedMarch = forcedMarchEffect && !rest;

  const extra = { rations: 0, water: 0, wagon: 0 };
  for (const e of plan.effects) if (e.type === "extraDrain") extra[e.track] += e.perDay;

  const totalDays = Math.max(1, plan.baseDays + addDays);
  const food = consumption(roster).food;
  const waterBase = consumption(roster).water;
  const planRegion = plan.regionId ? regions[plan.regionId] : undefined;

  const days: DayPlan[] = [];
  let foodCum = 0;
  let waterCum = 0;
  for (let d = 1; d <= totalDays; d++) {
    // Spread the path over the days so the last hex is entered only on the last day; a lengthened
    // leg spends its extra days en route, not idling at the destination.
    const n = plan.path.length;
    const idx = Math.min(n - 1, Math.floor((d * n) / totalDays) - 1);
    const hex = n === 0 || idx < 0 ? plan.from : plan.path[idx];
    const rec: HexRecord | undefined = hexes[hex];
    const regionId = rec?.region ?? plan.regionId;
    const region = (regionId ? regions[regionId] : undefined) ?? planRegion;
    const difficulty: Difficulty = rec?.difficulty ?? plan.difficulty;

    const foodPrev = foodCum;
    const waterPrev = waterCum;
    foodCum += food;
    waterCum += waterBase * (region?.waterMultiplier ?? 1);

    let encounterBonus = plan.routeId ? plan.encounterBonus : ENCOUNTER_BONUS[difficulty];
    if (rec?.tags.includes("hunting-ground")) encounterBonus += 2;

    days.push({
      day: d,
      hex,
      drain: {
        rations: ceil(foodCum) - ceil(foodPrev) + extra.rations,
        water: ceil(waterCum) - ceil(waterPrev) + extra.water,
        wagon: WAGON_DRAIN[difficulty] - wagonDelta + extra.wagon,
      },
      encounterBonus,
      regionId,
      forcedMarchDc: forcedMarch
        ? settings.forcedMarchBaseDc + settings.forcedMarchStep * (input.consecutiveForcedMarch + d - 1)
        : null,
      preserveChoice: preserveOne,
      prompts: plan.prompts.filter((p) => p.when.kind === "day" && p.when.day === d).map((p) => p.text),
    });
  }

  const arrivalPrompts = plan.prompts
    .filter((p) => {
      if (p.when.kind === "day") return false;
      const roleId = p.when.roleId;
      const o = outcomes.find((x) => x.roleId === roleId);
      if (!o) return false;
      return p.when.kind === "roleSuccess" ? o.success : !o.success;
    })
    .map((p) => p.text);

  return {
    roles: outcomes,
    totalDays,
    surprised,
    mapState: mapState ?? "explored",
    days,
    arrivalPrompts,
    replenish: plan.effects.filter((e) => e.type === "replenish"),
  };
}

function planFromRoute(map: MapData, routeId: string): LegPlan {
  const route = map.routes[routeId];
  if (!route) throw new Error(`Unknown route: ${routeId}`);
  const last = route.hexes[route.hexes.length - 1];
  return {
    routeId: route.id,
    from: route.from,
    path: [...route.hexes],
    baseDays: route.days,
    difficulty: route.difficulty,
    encounterBonus: route.encounterBonus,
    effects: [...route.effects],
    prompts: [...route.prompts],
    regionId: (last ? map.hexes[last]?.region : null) ?? null,
  };
}

function planFromPath(map: MapData, from: HexKey, path: HexKey[]): LegPlan {
  let difficulty: Difficulty = "standard";
  let regionId: string | null = null;
  let rank = -1;
  for (const key of path) {
    const rec = map.hexes[key];
    const d = rec?.difficulty ?? "standard";
    if (DIFFICULTIES.indexOf(d) > rank) {
      rank = DIFFICULTIES.indexOf(d);
      difficulty = d;
      regionId = rec?.region ?? null;
    }
  }
  return {
    routeId: null,
    from,
    path: [...path],
    baseDays: path.length,
    difficulty,
    encounterBonus: ENCOUNTER_BONUS[difficulty],
    effects: [],
    prompts: [],
    regionId,
  };
}

function encounterTotal(roller: Roller, journeyDay: number, bonus: number) {
  const d20 = roller.d20();
  return { d20, total: d20 + journeyDay + bonus };
}

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
  return { d20: () => Math.floor(next() * 20) + 1 };
}

export const engine = {
  DEFAULT_ROLES,
  DEFAULT_SETTINGS,
  consumption,
  eaters,
  roleDc,
  rolesHeldBy,
  doublingPenalty,
  resolveLeg,
  planFromRoute,
  planFromPath,
  encounterTotal,
  hexAdjacent,
  seededRoller,
} satisfies EngineApi;

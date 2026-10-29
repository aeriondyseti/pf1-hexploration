// pf1 system adapter: every pf1 actor read/roll/condition call goes through here.
import type { Pf1Api } from "../contracts";
import type { Coins, Traveller, VehicleLink } from "../types";

export { foundryRoller } from "./roller";

const SIZE_MULTIPLIERS: Record<string, number> = {
  fine: 0.1,
  dim: 0.1,
  tiny: 0.1,
  sm: 0.5,
  med: 1,
  lg: 2,
  huge: 5,
  grg: 8,
  col: 12,
};

/** Skills whose rolls are made on a named subskill (Profession, Craft, Artistry, Lore). */
const SUBSKILL_PARENTS = new Set(["pro", "crf", "art", "lor"]);

const SIZE_ORDER = ["fine", "dim", "tiny", "sm", "med", "lg", "huge", "grg", "col"];

/** pf1 v11 prepares traits.size as { base: "med", value: 4 }, where value indexes pf1.config.sizeChart. */
function readSizeKey(actor: any): string | null {
  const size = actor?.system?.traits?.size;
  if (typeof size === "string") return size;
  const chart = typeof pf1 !== "undefined" ? pf1?.config?.sizeChart : undefined;
  const keys = chart && Object.keys(chart).length ? Object.keys(chart) : SIZE_ORDER;
  if (typeof size?.value === "number") return keys[size.value] ?? null;
  if (typeof size?.value === "string") return size.value;
  return typeof size?.base === "string" ? size.base : null;
}

/** Creature type strings from wherever this actor keeps them, lower-cased. */
function creatureTypes(actor: any): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") out.push(v.toLowerCase());
    else if (Array.isArray(v) || v instanceof Set) for (const x of v) add(x);
    else if (v && typeof v === "object" && "value" in v) add((v as any).value);
  };
  const race = actor?.race?.system;
  add(race?.creatureTypes);
  add(race?.creatureType);
  add(actor?.system?.traits?.creatureTypes);
  add(actor?.system?.traits?.creatureTypes?.standard); // prepared: { standard: Set<string> }
  add(actor?.system?.traits?.type);
  return out;
}

/** A pf1 roll result's total: rollSkill/rollSavingThrow return a ChatMessage or roll data. */
function totalOf(result: any): number | null {
  // With chatMessage: false pf1 returns message data, whose rolls may be serialised JSON strings.
  let first = result?.rolls?.[0];
  if (typeof first === "string") {
    try {
      first = JSON.parse(first);
    } catch {
      first = null;
    }
  }
  const total = first?.total ?? result?.total ?? result?.roll?.total;
  return typeof total === "number" ? total : null;
}

function pf1Skills(): Record<string, string> {
  if (typeof pf1 !== "undefined" && pf1?.config?.skills) return pf1.config.skills;
  if (typeof CONFIG !== "undefined" && CONFIG?.PF1?.skills) return CONFIG.PF1.skills;
  return {};
}

function label(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (typeof game !== "undefined" && game?.i18n?.localize) return game.i18n.localize(value);
  return value;
}

/** Body weight by size, lb (DESIGN §4.7, provisional). */
const BODY_WEIGHT: Record<string, number> = {
  fine: 1,
  dim: 5,
  tiny: 20,
  sm: 40,
  med: 180,
  lg: 1400,
  huge: 11000,
  grg: 90000,
  col: 700000,
};

/** Team strength in Large equivalents. */
const PULL: Record<string, number> = { sm: 0.25, med: 0.5, lg: 1, huge: 2, grg: 4, col: 8 };

/** Vehicle defaults by name (UE team, UCombat seats and capacity); the first match wins. */
const VEHICLE_DEFAULTS: [string, { teamRequired: number; seats: number; cargoCapacity: number }][] = [
  ["light wagon", { teamRequired: 1, seats: 4, cargoCapacity: 1000 }],
  ["heavy wagon", { teamRequired: 4, seats: 4, cargoCapacity: 4000 }],
  ["medium wagon", { teamRequired: 2, seats: 4, cargoCapacity: 2000 }],
  ["carriage", { teamRequired: 1, seats: 4, cargoCapacity: 300 }],
  ["wagon", { teamRequired: 2, seats: 4, cargoCapacity: 2000 }],
  ["cart", { teamRequired: 1, seats: 2, cargoCapacity: 300 }],
];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Weight of one item stack, lb: pf1's prepared total when present, else unit weight × quantity (+ contents). */
function itemWeight(item: any): number {
  const w = item?.system?.weight;
  const total = num(w?.total);
  if (total !== null) return total;
  const qty = num(item?.system?.quantity) ?? 1;
  const unit = num(w?.value) ?? num(w) ?? 0;
  let weight = unit * qty;
  if (item?.type === "container") for (const inner of item.items ?? []) weight += itemWeight(inner);
  return weight;
}

const COIN_KEYS = ["pp", "gp", "sp", "cp"] as const;

const titleCase = (s: string) => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const pf1Adapter = {
  sizeMultiplier(actor: any): number {
    const key = readSizeKey(actor);
    return (key ? SIZE_MULTIPLIERS[key] : undefined) ?? 1;
  },

  sizeKey(actor: any): string {
    return readSizeKey(actor) ?? "med";
  },

  consumptionFor(actor: any): { food: number; water: number } {
    const types = creatureTypes(actor);
    const traits = actor?.system?.traits;
    if (traits?.undead === true || traits?.construct === true) return { food: 0, water: 0 };
    if (types.includes("construct") || types.includes("undead")) return { food: 0, water: 0 };
    const m = pf1Adapter.sizeMultiplier(actor);
    return { food: m, water: m };
  },

  travellerFor(actor: any): Traveller {
    const { food, water } = pf1Adapter.consumptionFor(actor);
    return { actorUuid: actor.uuid, name: actor.name, food, water, wage: 0, seat: null };
  },

  vehicleFor(actor: any): VehicleLink {
    const name = String(actor?.name ?? "").toLowerCase();
    const found = VEHICLE_DEFAULTS.find(([key]) => name.includes(key))?.[1] ?? { teamRequired: 1, seats: 4, cargoCapacity: 1000 };
    return { actorUuid: actor.uuid, name: actor.name, driver: null, team: [], ...found, milesPerDay: 16 };
  },

  isVehicle(actor: any): boolean {
    return actor?.type === "vehicle";
  },

  landSpeed(actor: any): number {
    const land = actor?.system?.attributes?.speed?.land;
    return num(land?.total) ?? num(land?.base) ?? num(land) ?? 30;
  },

  riderWeight(actor: any): number {
    const body = BODY_WEIGHT[pf1Adapter.sizeKey(actor)] ?? 180;
    const enc = actor?.system?.attributes?.encumbrance;
    const carried = num(enc?.carriedWeight) ?? num(enc?.carried) ?? 0;
    return body + carried;
  },

  inventoryWeight(actor: any): number {
    let total = 0;
    for (const item of actor?.items ?? []) total += itemWeight(item);
    return Math.round(total * 100) / 100;
  },

  pullStrength(actor: any): number {
    return PULL[pf1Adapter.sizeKey(actor)] ?? 0;
  },

  vehicleHp(actor: any): { hp: number; maxHp: number } {
    const hp = actor?.system?.attributes?.hp;
    return { hp: num(hp?.value) ?? 0, maxHp: num(hp?.max) ?? 0 };
  },

  async setVehicleHp(actor: any, hp: number): Promise<void> {
    await actor.update({ "system.attributes.hp.value": Math.round(hp) });
  },

  coins(actor: any): Coins {
    const c = actor?.system?.currency ?? {};
    return { pp: num(c.pp) ?? 0, gp: num(c.gp) ?? 0, sp: num(c.sp) ?? 0, cp: num(c.cp) ?? 0 };
  },

  async setCoins(actor: any, coins: Coins): Promise<void> {
    const update: Record<string, number> = {};
    for (const k of COIN_KEYS) update[`system.currency.${k}`] = Math.max(0, Math.floor(coins[k] ?? 0));
    await actor.update(update);
  },

  bestSkill(actor: any, skills: string[]): string {
    const actorSkills = actor?.system?.skills ?? {};
    let best: string | null = null;
    let bestMod = -Infinity;
    const consider = (id: string, mod: unknown) => {
      if (typeof mod === "number" && mod > bestMod) {
        best = id;
        bestMod = mod;
      }
    };
    for (const id of skills) {
      const skill = actorSkills[id];
      if (!skill) continue;
      if (SUBSKILL_PARENTS.has(id)) {
        for (const [key, sub] of Object.entries<any>(skill.subSkills ?? {})) consider(`${id}.${key}`, sub?.mod);
        // A bare parent with no subskills (e.g. untrained Craft) can still be rolled.
        if (best === null) consider(id, skill.mod);
      } else consider(id, skill.mod);
    }
    return best ?? skills[0] ?? "sur";
  },

  skillMod(actor: any, skillId: string): number {
    const [main, sub] = skillId.split(".").filter((p) => p !== "subSkills");
    const skill = actor?.system?.skills?.[main];
    return num(sub ? skill?.subSkills?.[sub]?.mod : skill?.mod) ?? 0;
  },

  skillLabel(skillId: string): string {
    const [main, sub] = skillId.split(".").filter((p) => p !== "subSkills");
    const name = label(pf1Skills()[main], main);
    return sub ? `${name} (${sub})` : name;
  },

  // No dialog and no chat card (the travel controller posts one card a day). pf1 v11 overwrites
  // options.flavor, so the doubling penalty is labelled inside the bonus formula instead.
  async rollSkill(actor: any, skillId: string, penalty: number): Promise<number | null> {
    const options: Record<string, unknown> = { skipDialog: true, chatMessage: false };
    if (penalty > 0) options.bonus = `-${penalty}[Doubling]`;
    try {
      return totalOf(await actor.rollSkill(skillId, options));
    } catch (err) {
      console.error("pf1-hexploration | rollSkill failed", err);
      return null;
    }
  },

  conditions(actor: any): string[] {
    const statuses: string[] = actor?.statuses ? Array.from(actor.statuses as Iterable<string>) : [];
    const registry = typeof pf1 !== "undefined" ? pf1?.registry?.conditions : undefined;
    return statuses.map((id) => label(registry?.get?.(id)?.name, titleCase(String(id))));
  },

  playerOwners(actor: any): string[] {
    const users: any[] = typeof game !== "undefined" && game?.users ? Array.from(game.users) : [];
    return users.filter((u) => !u.isGM && actor?.testUserPermission?.(u, "OWNER")).map((u) => u.id);
  },
} satisfies Pf1Api;

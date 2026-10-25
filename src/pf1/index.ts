// pf1 system adapter: every pf1 actor read/roll/condition call goes through here.
import type { Pf1Api } from "../contracts";
import type { RosterMember } from "../types";

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
function sizeKey(actor: any): string | null {
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
  const total = result?.rolls?.[0]?.total ?? result?.total ?? result?.roll?.total;
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

export const pf1Adapter = {
  sizeMultiplier(actor: any): number {
    const key = sizeKey(actor);
    return (key ? SIZE_MULTIPLIERS[key] : undefined) ?? 1;
  },

  consumptionFor(actor: any): { food: number; water: number } {
    const types = creatureTypes(actor);
    const traits = actor?.system?.traits;
    if (traits?.undead === true || traits?.construct === true) return { food: 0, water: 0 };
    if (types.includes("construct") || types.includes("undead")) return { food: 0, water: 0 };
    const m = pf1Adapter.sizeMultiplier(actor);
    return { food: m, water: m };
  },

  rosterMemberFor(actor: any, draft = false): RosterMember {
    const { food, water } = pf1Adapter.consumptionFor(actor);
    return {
      actorUuid: actor.uuid,
      name: actor.name,
      food,
      water,
      draft,
      npc: pf1Adapter.playerOwners(actor).length === 0,
    };
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

  skillLabel(skillId: string): string {
    const [main, sub] = skillId.split(".").filter((p) => p !== "subSkills");
    const name = label(pf1Skills()[main], main);
    return sub ? `${name} (${sub})` : name;
  },

  // pf1 v11 overwrites options.flavor with its own "Skill Check" text, so the caller's flavor is
  // not passed; the doubling penalty is labelled inside the bonus formula instead.
  async rollSkill(actor: any, skillId: string, penalty: number, _flavor: string): Promise<number | null> {
    const options: Record<string, unknown> = { skipDialog: true };
    if (penalty > 0) options.bonus = `-${penalty}[Doubling]`;
    try {
      return totalOf(await actor.rollSkill(skillId, options));
    } catch (err) {
      console.error("pf1-hexploration | rollSkill failed", err);
      return null;
    }
  },

  async rollFort(actor: any, _flavor: string): Promise<number | null> {
    try {
      return totalOf(await actor.rollSavingThrow("fort", { skipDialog: true }));
    } catch (err) {
      console.error("pf1-hexploration | rollSavingThrow failed", err);
      return null;
    }
  },

  hasCondition(actor: any, condition: string): boolean {
    return !!actor?.statuses?.has?.(condition);
  },

  async setCondition(actor: any, condition: string, on: boolean): Promise<void> {
    await actor.setCondition(condition, on);
  },

  playerOwners(actor: any): string[] {
    const users: any[] = typeof game !== "undefined" && game?.users ? Array.from(game.users) : [];
    return users.filter((u) => !u.isGM && actor?.testUserPermission?.(u, "OWNER")).map((u) => u.id);
  },
} satisfies Pf1Api;

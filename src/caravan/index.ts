// Caravan service (hx.caravan): placing the caravan and editing its roster, with typed results and one
// ledger entry per call (invariant 4). GM-only writes (invariant 2). The Caravan window calls these same
// functions, so the window and an agent can never disagree about what "add" means.
import type { CaravanApi } from "../contracts";
import { ledger } from "../ledger";
import { pf1Adapter } from "../pf1";
import { store } from "../store";
import { exclusive } from "../travel";
import {
  CARAVAN_TOKEN,
  CARAVAN_TYPE,
  type CaravanErrorCode,
  type CaravanResult,
  type CaravanState,
  type Change,
  type HexKey,
  type MemberOpts,
  type MemberPatch,
  type RosterMember,
} from "../types";

const clone = <T>(value: T): T => structuredClone(value);
const fail = (code: CaravanErrorCode, error: string): CaravanResult => ({ ok: false, code, error });

/** Record the change set and the caravan snapshot as one ledger entry, then write the caravan. */
async function write(label: string, before: CaravanState, after: CaravanState, changes: Change[] = []): Promise<CaravanResult> {
  const entry = await ledger.record(label, [...changes, { kind: "caravan", before, after: clone(after) }]);
  await store.setCaravan(after);
  store.notify();
  return { ok: true, caravan: clone(after), ledgerId: entry.id };
}

/** Common refusals: a player's client, or no caravan yet. */
function refuse(): CaravanResult | null {
  if (!game.user?.isGM) return fail("gm-only", "Only the GM can change the caravan.");
  if (!store.getCaravanActor()) return fail("no-caravan-actor", "No caravan is set: create or choose one in the Caravan window.");
  return null;
}

/** Run a GM write in the shared caravan queue, turning any unexpected error into a result. */
function gmWrite(fn: () => Promise<CaravanResult>): Promise<CaravanResult> {
  const refused = refuse();
  if (refused) return Promise.resolve(refused);
  return exclusive(async () => {
    try {
      return (refuse() ?? (await fn()));
    } catch (err) {
      return fail("failed", err instanceof Error ? err.message : String(err));
    }
  });
}

const legActive = (c: CaravanState) => c.leg?.status === "muster" || c.leg?.status === "underway";

function parseHex(hex: unknown): { i: number; j: number } | null {
  if (typeof hex !== "string") return null;
  const parts = hex.split(",");
  if (parts.length !== 2) return null;
  const [i, j] = parts.map((p) => Number(p.trim()));
  return Number.isInteger(i) && Number.isInteger(j) ? { i, j } : null;
}

function sceneFor(sceneId?: string): any | null {
  return (sceneId ? game.scenes?.get(sceneId) : canvas?.scene) ?? null;
}

/** The viewed canvas grid when the scene is on screen, else the scene's own grid (a BaseGrid in v13). */
function gridFor(scene: any): any | null {
  return (scene?.id === canvas?.scene?.id ? canvas?.grid : scene?.grid) ?? null;
}

function caravanToken(scene: any): any | null {
  const actor = store.getCaravanActor();
  return actor ? (Array.from<any>(scene?.tokens ?? []).find((t) => t.actorId === actor.id) ?? null) : null;
}

const memberName = (c: CaravanState, uuid: string) => c.roster.find((m) => m.actorUuid === uuid)?.name ?? uuid;

const nonNegative = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;

export const caravan = {
  get(): CaravanState {
    return store.getCaravan();
  },

  member(actorUuid: string): RosterMember | null {
    return store.getCaravan().roster.find((m) => m.actorUuid === actorUuid) ?? null;
  },

  findMember(name: string): RosterMember | null {
    const want = String(name ?? "").trim().toLowerCase();
    return store.getCaravan().roster.find((m) => m.name.trim().toLowerCase() === want) ?? null;
  },

  place: (hex: HexKey, sceneId?: string) =>
    gmWrite(async () => {
      const before = store.getCaravan();
      if (legActive(before)) return fail("leg-active", "The caravan is on a leg: finish or cancel it before moving the caravan.");
      const offset = parseHex(hex);
      if (!offset) return fail("bad-value", `"${hex}" is not a hex key (expected "row,col").`);
      const scene = sceneFor(sceneId);
      if (!scene) return fail("off-grid", sceneId ? `No scene with id ${sceneId}.` : "No scene is being viewed.");
      const grid = gridFor(scene);
      if (!grid?.isHexagonal) return fail("not-hex-scene", `${scene.name} does not have a hexagonal grid.`);
      const center = grid.getCenterPoint(offset);
      const rect = scene.dimensions?.sceneRect;
      if (rect?.contains && !rect.contains(center.x, center.y)) return fail("off-grid", `Hex ${hex} is outside ${scene.name}.`);

      const changes: Change[] = [];
      const actor = store.getCaravanActor();
      const existing = caravanToken(scene);
      const width = (existing?.width ?? actor.prototypeToken?.width ?? 1) * (grid.sizeX ?? grid.size);
      const height = (existing?.height ?? actor.prototypeToken?.height ?? 1) * (grid.sizeY ?? grid.size);
      const at = { x: center.x - width / 2, y: center.y - height / 2 };
      if (existing) {
        const was = { x: existing.x, y: existing.y };
        if (was.x !== at.x || was.y !== at.y) {
          await existing.update(at);
          changes.push({ kind: "token", tokenUuid: existing.uuid, before: was, after: at });
        }
      } else {
        const doc = await actor.getTokenDocument({ ...CARAVAN_TOKEN, ...at });
        const [created] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
        if (created) changes.push({ kind: "tokenCreate", tokenUuid: created.uuid });
      }
      const after = clone(before);
      after.position = hex;
      after.sceneId = scene.id;
      return write("Place caravan", before, after, changes);
    }),

  unplace: (sceneId?: string) =>
    gmWrite(async () => {
      const before = store.getCaravan();
      if (legActive(before)) return fail("leg-active", "The caravan is on a leg: finish or cancel it before removing its token.");
      const scene = sceneFor(sceneId ?? before.sceneId ?? undefined);
      if (!scene) return fail("off-grid", "No scene to remove the caravan from.");
      const changes: Change[] = [];
      const token = caravanToken(scene);
      if (token) {
        const data = token.toObject();
        await token.delete();
        changes.push({ kind: "tokenDelete", sceneId: scene.id, data });
      }
      const after = clone(before);
      if (!after.sceneId || after.sceneId === scene.id) {
        after.position = null;
        after.sceneId = null;
      }
      return write("Remove caravan token", before, after, changes);
    }),

  add: (actorUuid: string, opts: MemberOpts = {}) =>
    gmWrite(async () => {
      const actor = typeof actorUuid === "string" ? fromUuidSync(actorUuid) : null;
      if (!actor) return fail("unknown-actor", `No actor with UUID ${actorUuid}.`);
      if (actor.type === CARAVAN_TYPE) return fail("caravan-actor", `${actor.name} is a caravan and can't join a roster.`);
      const before = store.getCaravan();
      if (before.roster.some((m) => m.actorUuid === actor.uuid)) return fail("duplicate", `${actor.name} is already on the roster.`);
      if (opts.draft !== undefined && typeof opts.draft !== "boolean") return fail("bad-value", "draft must be true or false.");
      if (opts.npc !== undefined && typeof opts.npc !== "boolean") return fail("bad-value", "npc must be true or false.");
      const member = pf1Adapter.rosterMemberFor(actor, opts.draft ?? false);
      if (opts.npc !== undefined) member.npc = opts.npc;
      const after = clone(before);
      after.roster.push(member);
      return write(`Add to roster: ${member.name}`, before, after);
    }),

  remove: (actorUuid: string) =>
    gmWrite(async () => {
      const before = store.getCaravan();
      const name = memberName(before, actorUuid);
      if (!before.roster.some((m) => m.actorUuid === actorUuid)) return fail("not-member", `${name} is not on the roster.`);
      if (legActive(before)) {
        const held = before.leg!.assignments.filter((a) => a.actorUuid === actorUuid).map((a) => a.roleId);
        if (held.length) {
          const roles = store.getRoles();
          const names = held.map((id) => roles.find((r) => r.id === id)?.name ?? id).join(", ");
          return fail("holds-role", `${name} holds ${names} on the active leg: release ${held.length > 1 ? "them" : "it"} first.`);
        }
      }
      const after = clone(before);
      after.roster = after.roster.filter((m) => m.actorUuid !== actorUuid);
      return write(`Remove from roster: ${name}`, before, after);
    }),

  update: (actorUuid: string, patch: MemberPatch) =>
    gmWrite(async () => {
      const before = store.getCaravan();
      const index = before.roster.findIndex((m) => m.actorUuid === actorUuid);
      if (index < 0) return fail("not-member", `${memberName(before, actorUuid)} is not on the roster.`);
      const p = patch ?? {};
      for (const key of ["food", "water"] as const) {
        if (p[key] !== undefined && !nonNegative(p[key])) return fail("bad-value", `${key} must be a number of at least 0.`);
      }
      for (const key of ["draft", "npc"] as const) {
        if (p[key] !== undefined && typeof p[key] !== "boolean") return fail("bad-value", `${key} must be true or false.`);
      }
      const after = clone(before);
      const m = after.roster[index];
      if (p.food !== undefined) m.food = p.food;
      if (p.water !== undefined) m.water = p.water;
      if (p.draft !== undefined) m.draft = p.draft;
      if (p.npc !== undefined) m.npc = p.npc;
      return write(`Update roster: ${m.name}`, before, after);
    }),

  setDraftRequired: (n: number) =>
    gmWrite(async () => {
      if (!Number.isInteger(n) || n < 0) return fail("bad-value", "The draft animal count must be a whole number of at least 0.");
      const before = store.getCaravan();
      const after = clone(before);
      after.draftRequired = n;
      return write(`Set draft required: ${n}`, before, after);
    }),
} satisfies CaravanApi;

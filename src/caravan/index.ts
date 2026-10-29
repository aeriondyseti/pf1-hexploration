// Caravan service (hx.caravan): placing the caravan and editing who travels in it, with typed results.
// The GM is the only writer (invariant 2): on the active GM's client edits apply at once; on a player's
// client they go to the GM as authority requests, which the GM validates against the sender's ownership.
// The Caravan sheet calls these same functions, so the sheet and an agent never disagree.
import type { CaravanApi } from "../contracts";
import { authority } from "../authority";
import { pf1Adapter } from "../pf1";
import { store } from "../store";
import {
  CARAVAN_TOKEN,
  CARAVAN_TYPE,
  ROLE_IDS,
  type CaravanErrorCode,
  type CaravanResult,
  type CaravanState,
  type Coins,
  type HexKey,
  type Request,
  type RequestResult,
  type RoleId,
  type Traveller,
  type VehicleLink,
} from "../types";

// ---------- the GM write queue ----------

let queue: Promise<unknown> = Promise.resolve();

/** Run GM writes one at a time (shared with the travel controller), so concurrent edits never interleave. */
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

// ---------- helpers ----------

const clone = <T>(value: T): T => structuredClone(value);
const fail = (code: CaravanErrorCode, error: string): CaravanResult => ({ ok: false, code, error });

/** Copper pieces per coin. */
export const COIN_CP: Coins = { pp: 1000, gp: 100, sp: 10, cp: 1 };
const COIN_KEYS = ["pp", "gp", "sp", "cp"] as const;
export const coinsToCp = (c: Coins) => COIN_KEYS.reduce((sum, k) => sum + (c[k] ?? 0) * COIN_CP[k], 0);

function actorFor(uuid: string | null | undefined): any | null {
  if (typeof uuid !== "string" || !uuid) return null;
  try {
    return fromUuidSync(uuid) ?? null;
  } catch {
    return null;
  }
}

/** Does this user own the actor? An empty slot (null) is "owned" by everyone (like the rebuild's canSetRole). */
function owns(user: any, uuid: string | null | undefined): boolean {
  if (!uuid) return true;
  if (user?.isGM) return true;
  return !!actorFor(uuid)?.testUserPermission?.(user, "OWNER");
}

const nameOf = (c: CaravanState, uuid: string | null | undefined) =>
  (uuid && (c.travellers.find((t) => t.actorUuid === uuid)?.name ?? c.vehicles.find((v) => v.actorUuid === uuid)?.name ?? actorFor(uuid)?.name)) ||
  "someone";

/** Roles an actor holds, driving included (max two, DESIGN §4.5). */
export function rolesHeld(c: CaravanState, uuid: string): number {
  const roles = ROLE_IDS.filter((id) => c.roles[id] === uuid).length;
  return roles + c.vehicles.filter((v) => v.driver === uuid).length;
}

/** Take an actor out of every seat, driver slot and team (an actor is in at most one of them). */
function detach(c: CaravanState, uuid: string): void {
  const t = c.travellers.find((x) => x.actorUuid === uuid);
  if (t) t.seat = null;
  for (const v of c.vehicles) {
    if (v.driver === uuid) v.driver = null;
    v.team = v.team.filter((x) => x !== uuid);
  }
}

async function whisperGM(content: string): Promise<void> {
  try {
    const whisper = (game.users?.filter?.((u: any) => u.isGM) ?? []).map((u: any) => u.id);
    if (!whisper.length) return;
    await ChatMessage.create({ content, whisper, speaker: { alias: "Caravan" } });
  } catch (err) {
    console.error("pf1-hexploration | whisper failed", err);
  }
}

const isWhole = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const nonNegative = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const coinText = (c: Coins) =>
  COIN_KEYS.filter((k) => c[k])
    .map((k) => `${c[k]} ${k}`)
    .join(", ") || "0 cp";

async function save(next: CaravanState): Promise<CaravanResult> {
  await store.setCaravan(next);
  return { ok: true, caravan: clone(next) };
}

// ---------- request handlers (run on the active GM, as `user`) ----------

type Apply = (request: any, user: any) => Promise<CaravanResult>;

const apply: Record<string, Apply> = {
  async addActor(req: Extract<Request, { type: "addActor" }>, user) {
    const actor = actorFor(req.actorUuid);
    if (!actor) return fail("unknown-actor", `No actor with UUID ${req.actorUuid}.`);
    if (actor.type === CARAVAN_TYPE) return fail("caravan-actor", `${actor.name} is a caravan and can't join one.`);
    if (!owns(user, actor.uuid)) return fail("not-owner", `You don't own ${actor.name}.`);
    const c = store.getCaravan();
    if (c.travellers.some((t) => t.actorUuid === actor.uuid) || c.vehicles.some((v) => v.actorUuid === actor.uuid)) {
      return fail("duplicate", `${actor.name} is already in the caravan.`);
    }
    const vehicle = pf1Adapter.isVehicle(actor);
    if (vehicle) c.vehicles.push(pf1Adapter.vehicleFor(actor));
    else c.travellers.push(pf1Adapter.travellerFor(actor));
    const result = await save(c);
    if (!user?.isGM) await whisperGM(`${user?.name ?? "A player"} added ${actor.name} to the caravan${vehicle ? " as a vehicle" : ""}.`);
    return result;
  },

  async removeActor(req: Extract<Request, { type: "removeActor" }>, user) {
    const c = store.getCaravan();
    const name = nameOf(c, req.actorUuid);
    const isTraveller = c.travellers.some((t) => t.actorUuid === req.actorUuid);
    const isVehicle = c.vehicles.some((v) => v.actorUuid === req.actorUuid);
    if (!isTraveller && !isVehicle) return fail("not-member", `${name} is not in the caravan.`);
    if (!owns(user, req.actorUuid)) return fail("not-owner", `You don't own ${name}.`);
    detach(c, req.actorUuid);
    for (const id of ROLE_IDS) if (c.roles[id] === req.actorUuid) c.roles[id] = null;
    c.travellers = c.travellers.filter((t) => t.actorUuid !== req.actorUuid);
    c.vehicles = c.vehicles.filter((v) => v.actorUuid !== req.actorUuid);
    for (const t of c.travellers) if (t.seat === req.actorUuid) t.seat = null;
    const result = await save(c);
    if (!user?.isGM) await whisperGM(`${user?.name ?? "A player"} removed ${name} from the caravan.`);
    return result;
  },

  async setSeat(req: Extract<Request, { type: "setSeat" }>, user) {
    const c = store.getCaravan();
    const t = c.travellers.find((x) => x.actorUuid === req.actorUuid);
    if (!t) return fail("not-member", `${nameOf(c, req.actorUuid)} is not travelling with the caravan.`);
    if (!owns(user, t.actorUuid)) return fail("not-owner", `You don't own ${t.name}.`);
    if (req.vehicleUuid && !c.vehicles.some((v) => v.actorUuid === req.vehicleUuid)) return fail("not-vehicle", "That vehicle is not in the caravan.");
    detach(c, t.actorUuid);
    t.seat = req.vehicleUuid ?? null;
    return save(c);
  },

  async setDriver(req: Extract<Request, { type: "setDriver" }>, user) {
    const c = store.getCaravan();
    const v = c.vehicles.find((x) => x.actorUuid === req.vehicleUuid);
    if (!v) return fail("not-vehicle", "That vehicle is not in the caravan.");
    if (!owns(user, v.driver)) return fail("not-owner", `${nameOf(c, v.driver)} is driving the ${v.name}.`);
    if (req.actorUuid) {
      const t = c.travellers.find((x) => x.actorUuid === req.actorUuid);
      if (!t) return fail("not-member", `${nameOf(c, req.actorUuid)} is not travelling with the caravan.`);
      if (!owns(user, t.actorUuid)) return fail("not-owner", `You don't own ${t.name}.`);
      if (v.driver !== t.actorUuid) {
        const roles = ROLE_IDS.filter((id) => c.roles[id] === t.actorUuid).length;
        if (roles + 1 > 2) return fail("too-many-roles", `${t.name} already holds two roles.`);
      }
      detach(c, t.actorUuid);
    }
    v.driver = req.actorUuid ?? null;
    return save(c);
  },

  async setTeam(req: Extract<Request, { type: "setTeam" }>, user) {
    const c = store.getCaravan();
    const v = c.vehicles.find((x) => x.actorUuid === req.vehicleUuid);
    if (!v) return fail("not-vehicle", "That vehicle is not in the caravan.");
    const t = c.travellers.find((x) => x.actorUuid === req.actorUuid);
    if (!t) return fail("not-member", `${nameOf(c, req.actorUuid)} is not travelling with the caravan.`);
    if (!owns(user, t.actorUuid)) return fail("not-owner", `You don't own ${t.name}.`);
    if (req.on) {
      detach(c, t.actorUuid);
      v.team.push(t.actorUuid);
    } else v.team = v.team.filter((x) => x !== t.actorUuid);
    return save(c);
  },

  async setRole(req: Extract<Request, { type: "setRole" }>, user) {
    if (!ROLE_IDS.includes(req.roleId)) return fail("bad-value", `Unknown role ${String(req.roleId)}.`);
    const c = store.getCaravan();
    const holder = c.roles[req.roleId] ?? null;
    if (!owns(user, holder)) return fail("not-owner", `${nameOf(c, holder)} holds that role.`);
    if (req.actorUuid) {
      const t = c.travellers.find((x) => x.actorUuid === req.actorUuid);
      if (!t) return fail("not-member", `${nameOf(c, req.actorUuid)} is not travelling with the caravan.`);
      if (!owns(user, t.actorUuid)) return fail("not-owner", `You don't own ${t.name}.`);
      if (holder !== t.actorUuid && rolesHeld(c, t.actorUuid) + 1 > 2) return fail("too-many-roles", `${t.name} already holds two roles.`);
    }
    c.roles[req.roleId] = req.actorUuid ?? null;
    return save(c);
  },

  async funds(req: Extract<Request, { type: "funds" }>, user) {
    const actor = actorFor(req.actorUuid);
    if (!actor) return fail("unknown-actor", `No actor with UUID ${req.actorUuid}.`);
    if (actor.type === CARAVAN_TYPE) return fail("caravan-actor", "Pick a character, not the caravan.");
    if (!owns(user, actor.uuid)) return fail("not-owner", `You don't own ${actor.name}.`);
    const coins = req.coins ?? ({} as Coins);
    if (!COIN_KEYS.every((k) => isWhole(coins[k] ?? 0))) return fail("bad-value", "Coins must be whole numbers of at least 0.");
    const amount: Coins = { pp: coins.pp ?? 0, gp: coins.gp ?? 0, sp: coins.sp ?? 0, cp: coins.cp ?? 0 };
    const cp = coinsToCp(amount);
    if (cp <= 0) return fail("bad-value", "Enter an amount.");
    const c = store.getCaravan();
    const purse = pf1Adapter.coins(actor);
    const next: Coins = { ...purse };
    if (req.direction === "deposit") {
      for (const k of COIN_KEYS) {
        if (purse[k] < amount[k]) return fail("insufficient-funds", `${actor.name} has only ${purse[k]} ${k}.`);
        next[k] = purse[k] - amount[k];
      }
      c.funds += cp;
    } else if (req.direction === "withdraw") {
      if (c.funds < cp) return fail("insufficient-funds", `The party funds hold only ${c.funds} cp.`);
      for (const k of COIN_KEYS) next[k] = purse[k] + amount[k];
      c.funds -= cp;
    } else return fail("bad-value", "direction must be deposit or withdraw.");
    await pf1Adapter.setCoins(actor, next);
    const result = await save(c);
    if (!user?.isGM) {
      const verb = req.direction === "deposit" ? `deposited ${coinText(amount)} from ${actor.name} into` : `withdrew ${coinText(amount)} to ${actor.name} from`;
      await whisperGM(`${user?.name ?? "A player"} ${verb} the party funds.`);
    }
    return result;
  },
};

/** Run a request on the active GM: refuse with no caravan, turn unexpected errors into a result. */
function run(request: Request, user: any): Promise<CaravanResult> {
  return exclusive(async () => {
    if (!store.getCaravanActor()) return fail("no-caravan-actor", "No caravan is set: create or choose one in the Caravan window.");
    try {
      return await apply[request.type](request, user);
    } catch (err) {
      return fail("failed", err instanceof Error ? err.message : String(err));
    }
  });
}

/** A public edit: direct on the active GM, a request otherwise. */
async function edit(request: Request): Promise<CaravanResult> {
  if (authority.isActiveGM()) return run(request, game.user);
  const reply: RequestResult & { code?: CaravanErrorCode } = await authority.send(request);
  if (reply.ok) return { ok: true, caravan: store.getCaravan() };
  return fail(reply.code ?? "failed", reply.error ?? "The GM's client refused the change.");
}

/** GM-only writes (placement, numbers). */
function gmWrite(fn: () => Promise<CaravanResult>): Promise<CaravanResult> {
  if (!game.user?.isGM) return Promise.resolve(fail("gm-only", "Only the GM can do that."));
  return exclusive(async () => {
    if (!store.getCaravanActor()) return fail("no-caravan-actor", "No caravan is set: create or choose one in the Caravan window.");
    try {
      return await fn();
    } catch (err) {
      return fail("failed", err instanceof Error ? err.message : String(err));
    }
  });
}

// ---------- placement ----------

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

// ---------- the service ----------

export const caravan = {
  init() {
    for (const type of ["addActor", "removeActor", "setSeat", "setDriver", "setTeam", "setRole", "funds"] as const) {
      authority.registerHandler(type, async (request, userId) => {
        const user = game.users?.get(userId);
        if (!user) return { ok: false, error: "Unknown user" };
        const result = await run(request, user);
        return result.ok ? { ok: true } : ({ ok: false, error: result.error, code: result.code } as RequestResult);
      });
    }
  },

  get(): CaravanState {
    return store.getCaravan();
  },

  traveller(actorUuid: string): Traveller | null {
    return store.getCaravan().travellers.find((t) => t.actorUuid === actorUuid) ?? null;
  },

  vehicle(actorUuid: string): VehicleLink | null {
    return store.getCaravan().vehicles.find((v) => v.actorUuid === actorUuid) ?? null;
  },

  place: (hex: HexKey, sceneId?: string) =>
    gmWrite(async () => {
      const c = store.getCaravan();
      if (c.trip) return fail("trip-active", "The caravan is on a trip: stop it before moving the caravan.");
      const offset = parseHex(hex);
      if (!offset) return fail("bad-value", `"${hex}" is not a hex key (expected "row,col").`);
      const scene = sceneFor(sceneId);
      if (!scene) return fail("off-grid", sceneId ? `No scene with id ${sceneId}.` : "No scene is being viewed.");
      const grid = gridFor(scene);
      if (!grid?.isHexagonal) return fail("not-hex-scene", `${scene.name} does not have a hexagonal grid.`);
      const center = grid.getCenterPoint(offset);
      const rect = scene.dimensions?.sceneRect;
      if (rect?.contains && !rect.contains(center.x, center.y)) return fail("off-grid", `Hex ${hex} is outside ${scene.name}.`);

      const actor = store.getCaravanActor();
      const existing = caravanToken(scene);
      const width = (existing?.width ?? actor.prototypeToken?.width ?? 1) * (grid.sizeX ?? grid.size);
      const height = (existing?.height ?? actor.prototypeToken?.height ?? 1) * (grid.sizeY ?? grid.size);
      const at = { x: center.x - width / 2, y: center.y - height / 2 };
      if (existing) {
        if (existing.x !== at.x || existing.y !== at.y) await existing.update(at);
      } else {
        const doc = await actor.getTokenDocument({ ...CARAVAN_TOKEN, ...at });
        await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
      }
      c.position = hex;
      c.sceneId = scene.id;
      return save(c);
    }),

  unplace: (sceneId?: string) =>
    gmWrite(async () => {
      const c = store.getCaravan();
      if (c.trip) return fail("trip-active", "The caravan is on a trip: stop it before removing its token.");
      const scene = sceneFor(sceneId ?? c.sceneId ?? undefined);
      if (!scene) return fail("off-grid", "No scene to remove the caravan from.");
      const token = caravanToken(scene);
      if (token) await token.delete();
      if (!c.sceneId || c.sceneId === scene.id) {
        c.position = null;
        c.sceneId = null;
      }
      return save(c);
    }),

  add: (actorUuid: string) => edit({ type: "addActor", actorUuid }),
  remove: (actorUuid: string) => edit({ type: "removeActor", actorUuid }),
  setSeat: (actorUuid: string, vehicleUuid: string | null) => edit({ type: "setSeat", actorUuid, vehicleUuid }),
  setDriver: (vehicleUuid: string, actorUuid: string | null) => edit({ type: "setDriver", vehicleUuid, actorUuid }),
  setTeam: (vehicleUuid: string, actorUuid: string, on: boolean) => edit({ type: "setTeam", vehicleUuid, actorUuid, on }),
  setRole: (roleId: RoleId, actorUuid: string | null) => edit({ type: "setRole", roleId, actorUuid }),
  deposit: (actorUuid: string, coins: Coins) => edit({ type: "funds", actorUuid, coins, direction: "deposit" }),
  withdraw: (actorUuid: string, coins: Coins) => edit({ type: "funds", actorUuid, coins, direction: "withdraw" }),

  updateTraveller: (actorUuid: string, patch: Partial<Pick<Traveller, "food" | "water" | "wage">>) =>
    gmWrite(async () => {
      const c = store.getCaravan();
      const t = c.travellers.find((x) => x.actorUuid === actorUuid);
      if (!t) return fail("not-member", `${nameOf(c, actorUuid)} is not travelling with the caravan.`);
      const p = patch ?? {};
      for (const key of ["food", "water", "wage"] as const) {
        if (p[key] !== undefined && !nonNegative(p[key])) return fail("bad-value", `${key} must be a number of at least 0.`);
      }
      if (p.food !== undefined) t.food = p.food;
      if (p.water !== undefined) t.water = p.water;
      if (p.wage !== undefined) t.wage = Math.round(p.wage);
      return save(c);
    }),

  updateVehicle: (actorUuid: string, patch: Partial<Pick<VehicleLink, "seats" | "cargoCapacity" | "teamRequired" | "milesPerDay">>) =>
    gmWrite(async () => {
      const c = store.getCaravan();
      const v = c.vehicles.find((x) => x.actorUuid === actorUuid);
      if (!v) return fail("not-vehicle", `${nameOf(c, actorUuid)} is not a vehicle in the caravan.`);
      const p = patch ?? {};
      for (const key of ["seats", "cargoCapacity", "teamRequired", "milesPerDay"] as const) {
        if (p[key] !== undefined && !nonNegative(p[key])) return fail("bad-value", `${key} must be a number of at least 0.`);
      }
      if (p.seats !== undefined) v.seats = Math.round(p.seats);
      if (p.cargoCapacity !== undefined) v.cargoCapacity = p.cargoCapacity;
      if (p.teamRequired !== undefined) v.teamRequired = p.teamRequired;
      if (p.milesPerDay !== undefined) v.milesPerDay = p.milesPerDay;
      return save(c);
    }),
} satisfies CaravanApi;

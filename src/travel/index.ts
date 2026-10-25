// Leg controller: muster -> resolve -> day steps -> arrival. Every world write runs on the GM
// (invariant 2) and every GM mutation is recorded in the ledger (invariant 4).
import type { TravelApi } from "../contracts";
import type {
  CaravanState,
  Change,
  DayPlan,
  HexKey,
  KnowledgeState,
  LegPlan,
  LegState,
  Request,
  RequestResult,
  RosterMember,
  SupplyTrack,
} from "../types";
import { authority } from "../authority";
import { engine, legRoleDc } from "../engine";
import { ledger } from "../ledger";
import { pf1Adapter, foundryRoller } from "../pf1";
import { store } from "../store";

const DAY_SECONDS = 86400;
const KNOWLEDGE_RANK: Record<KnowledgeState, number> = { unknown: 0, explored: 1, mapped: 2 };

// ---------- small helpers ----------

const clone = <T>(v: T): T => structuredClone(v);

function randomId(): string {
  return typeof foundry !== "undefined" && foundry?.utils?.randomID
    ? foundry.utils.randomID()
    : Math.random().toString(36).slice(2, 18);
}

// `ui` is not in the shared globals file; read it off globalThis.
const notifications = (): any => (globalThis as any).ui?.notifications;

function gmOnly(): boolean {
  if (game.user?.isGM) return true;
  notifications()?.warn("PF1 Hexploration: only the GM can do that.");
  return false;
}

function warn(message: string): void {
  notifications()?.warn(message);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function gmIds(): string[] {
  return Array.from<any>(game.users)
    .filter((u) => u.isGM)
    .map((u) => u.id);
}

async function postPublic(content: string): Promise<void> {
  await ChatMessage.create({ content });
}

async function whisper(userIds: string[], content: string): Promise<void> {
  if (userIds.length) await ChatMessage.create({ content, whisper: userIds });
}

const whisperGM = (content: string) => whisper(gmIds(), content);

function parseKey(key: HexKey): { i: number; j: number } {
  const [i, j] = key.split(",").map(Number);
  return { i, j };
}

// Every caravan read-modify-write on the GM runs through this one queue, so a player request handled
// during a day step's awaits cannot be overwritten by it (and ledger snapshots stay true).
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/** Record the change set (with the caravan snapshot) in one ledger entry, then write the caravan.
 *  Recording first means a failed write still leaves an entry that undo can replay safely. */
async function commit(label: string, before: CaravanState, after: CaravanState, changes: Change[] = []): Promise<void> {
  await ledger.record(label, [...changes, { kind: "caravan", before, after: clone(after) }]);
  await store.setCaravan(after);
  store.notify();
}

/** Run a step whose side effects push Changes as they land. If it throws part-way, the changes
 *  already applied are still recorded (as a partial entry) so undo can revert them (invariant 4). */
async function step(
  label: string,
  before: CaravanState,
  body: (after: CaravanState, changes: Change[]) => Promise<string | void>,
): Promise<void> {
  const after = clone(before);
  const changes: Change[] = [];
  let finalLabel: string | void;
  try {
    finalLabel = await body(after, changes);
  } catch (err) {
    if (changes.length) await ledger.record(`${label} (partial)`, changes);
    store.notify();
    throw err;
  }
  await commit(finalLabel || label, before, after, changes);
}

/** Set a condition if it differs, recording the change. */
async function applyCondition(actor: any, condition: string, on: boolean, changes: Change[]): Promise<void> {
  const before = pf1Adapter.hasCondition(actor, condition);
  if (before === on) return;
  await pf1Adapter.setCondition(actor, condition, on);
  changes.push({ kind: "condition", actorUuid: actor.uuid, condition, before, after: on });
}

/** Exhausted. pf1 v11 keeps fatigued and exhausted on one condition track, so turning exhausted on
 *  silently clears fatigued; record that first so undo (newest first) restores it after. */
async function applyExhausted(actor: any, changes: Change[]): Promise<void> {
  if (pf1Adapter.hasCondition(actor, "exhausted")) return;
  if (pf1Adapter.hasCondition(actor, "fatigued")) {
    changes.push({ kind: "condition", actorUuid: actor.uuid, condition: "fatigued", before: true, after: false });
  }
  await applyCondition(actor, "exhausted", true, changes);
}

/** Fatigued, unless already Exhausted (setting fatigued would clear the worse condition). */
async function applyFatigued(actor: any, changes: Change[]): Promise<void> {
  if (pf1Adapter.hasCondition(actor, "exhausted")) return;
  await applyCondition(actor, "fatigued", true, changes);
}

/** Failed forced-march save: Fatigued, or Exhausted if already Fatigued. */
async function applyFatigue(actor: any, changes: Change[]): Promise<void> {
  if (pf1Adapter.hasCondition(actor, "fatigued")) await applyExhausted(actor, changes);
  else await applyFatigued(actor, changes);
}

function ownsActor(userId: string, actor: any): boolean {
  const user = game.users.get(userId);
  if (!user) return false;
  return !!user.isGM || !!actor?.testUserPermission?.(user, "OWNER");
}

function roleName(roleId: string): string {
  return store.getRoles().find((r) => r.id === roleId)?.name ?? roleId;
}

// ---------- day-step pieces ----------

/** Remove person-days from a track's hold items in order. Returns the drain left unpaid. */
async function drainTrack(track: SupplyTrack, amount: number, changes: Change[]): Promise<number> {
  let remaining = amount;
  for (const supply of store.supplyItems()) {
    if (remaining <= 0) break;
    if (supply.track !== track) continue;
    const before = Number(supply.item.system?.quantity ?? 0);
    if (before <= 0) continue;
    const per = supply.unitsPerQuantity > 0 ? supply.unitsPerQuantity : 1;
    const take = Math.min(before, Math.ceil(remaining / per - 1e-9));
    remaining = Math.max(0, remaining - take * per);
    changes.push(await store.setSupplyQuantity(supply, before - take));
  }
  return remaining;
}

async function applyAtZero(track: SupplyTrack, roster: RosterMember[], changes: Change[]): Promise<void> {
  const condition = track === "rations" ? "fatigued" : "exhausted";
  for (const m of roster) {
    if ((track === "rations" ? m.food : m.water) <= 0) continue;
    const actor = fromUuidSync(m.actorUuid);
    if (!actor) continue;
    if (condition === "exhausted") await applyExhausted(actor, changes);
    else await applyFatigued(actor, changes);
  }
  await whisperGM(
    `<p><strong>${track === "rations" ? "Rations" : "Water"} ran out.</strong> Travelers are ${condition}; ` +
      `apply Con damage per DESIGN §4.13.</p>`,
  );
}

async function moveToken(sceneId: string | null, hex: HexKey, changes: Change[]): Promise<void> {
  const actor = store.getCaravanActor();
  const scene = sceneId ? game.scenes?.get(sceneId) : canvas?.scene;
  if (!actor || !scene) return;
  // The viewed canvas grid only matches when the caravan's scene is the one on screen; otherwise use
  // the scene's own grid (a BaseGrid in v13).
  const viewed = scene.id === canvas?.scene?.id;
  const grid = viewed ? canvas?.grid : scene.grid;
  if (!grid?.getCenterPoint) return;
  const token = Array.from<any>(scene.tokens ?? []).find((t) => t.actorId === actor.id);
  if (!token) return;
  const center = grid.getCenterPoint(parseKey(hex));
  // Hex grids size tokens by sizeX/sizeY, which differ from grid.size on one axis.
  const size = (viewed ? token.object?.getSize?.() : null) ?? {
    width: token.width * (grid.sizeX ?? grid.size),
    height: token.height * (grid.sizeY ?? grid.size),
  };
  const after = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
  const before = { x: token.x, y: token.y };
  if (before.x === after.x && before.y === after.y) return;
  await token.update(after);
  changes.push({ kind: "token", tokenUuid: token.uuid, before, after });
}

async function forcedMarch(day: DayPlan, leg: LegState, roster: RosterMember[], changes: Change[]): Promise<void> {
  const dc = day.forcedMarchDc!;
  const prompted: string[] = [];
  for (const m of roster) {
    if (m.food <= 0) continue;
    const actor = fromUuidSync(m.actorUuid);
    if (!actor) continue;
    if (m.npc) {
      const total = await pf1Adapter.rollFort(actor, `Forced march (DC ${dc})`);
      leg.saves.push({ actorUuid: m.actorUuid, dc, day: day.day, total });
      if (total !== null && total < dc) await applyFatigue(actor, changes);
    } else {
      leg.saves.push({ actorUuid: m.actorUuid, dc, day: day.day, total: null });
      prompted.push(m.name);
      await whisper(
        pf1Adapter.playerOwners(actor),
        `<p><strong>Forced march:</strong> ${escapeHtml(m.name)} owes a Fortitude save (DC ${dc}). ` +
          `Roll it from the Travel window.</p>`,
      );
    }
  }
  if (prompted.length) await whisperGM(`<p>Forced march DC ${dc}: waiting on saves from ${escapeHtml(prompted.join(", "))}.</p>`);
}

async function encounter(caravan: CaravanState, day: DayPlan, surprised: boolean): Promise<void> {
  const { d20, total } = engine.encounterTotal(foundryRoller, caravan.journeyDay + 1, day.encounterBonus);
  const region = day.regionId ? store.getMap(caravan.sceneId ?? undefined).regions[day.regionId] : undefined;
  let resultText = "";
  if (region?.encounterTable) {
    try {
      const table = await fromUuid(region.encounterTable);
      const results: any[] = table?.getResultsForRoll?.(total) ?? [];
      resultText = results.map((r) => r.description || r.name || r.text || "").filter(Boolean).join("; ");
    } catch (err) {
      console.error("pf1-hexploration | encounter table lookup failed", err);
    }
  }
  const lines = [
    `<p><strong>Day ${day.day} encounter check:</strong> ${total} (d20 ${d20})${surprised ? " — the caravan is <em>surprised</em>" : ""}.</p>`,
  ];
  if (resultText) lines.push(`<p>${resultText}</p>`);
  if (region?.stormThreshold != null && total >= region.stormThreshold) {
    lines.push(`<p><strong>The storm reaches for them</strong> (threshold ${region.stormThreshold}).</p>`);
  }
  await whisperGM(lines.join(""));
}

/** Arrival effects on a caravan draft: knowledge, replenish, leg cleared. Returns the changes. */
async function arrivalChanges(caravan: CaravanState): Promise<Change[]> {
  const changes: Change[] = [];
  const leg = caravan.leg!;
  const outcome = leg.outcome!;
  const sceneId = caravan.sceneId ?? canvas?.scene?.id ?? null;

  if (sceneId) {
    const knowledge = store.getPartyMap(sceneId).knowledge;
    const target = outcome.mapState;
    const raised: HexKey[] = [];
    for (const key of new Set([leg.plan.from, ...leg.plan.path])) {
      const before = knowledge[key] ?? "unknown";
      if (KNOWLEDGE_RANK[target] > KNOWLEDGE_RANK[before]) {
        raised.push(key);
        changes.push({ kind: "knowledge", sceneId, key, before, after: target });
      }
    }
    if (raised.length) await store.setKnowledge(sceneId, raised, target);
  }

  for (const effect of outcome.replenish) {
    if (effect.type !== "replenish") continue;
    const supply = effect.track === "either" ? undefined : store.supplyItems().find((s) => s.track === effect.track);
    if (!supply) {
      await whisperGM(`<p>Arrival: replenish ${effect.amount} person-days of ${effect.track} — add it to the hold by hand.</p>`);
      continue;
    }
    const per = supply.unitsPerQuantity > 0 ? supply.unitsPerQuantity : 1;
    const before = Number(supply.item.system?.quantity ?? 0);
    changes.push(await store.setSupplyQuantity(supply, before + Math.round(effect.amount / per)));
  }

  caravan.leg = null;
  return changes;
}

// ---------- request handlers (run on the active GM) ----------

type Handler<T extends Request["type"]> = (req: Extract<Request, { type: T }>, userId: string) => Promise<RequestResult>;

const fail = (error: string): RequestResult => ({ ok: false, error });

const userName = (userId: string): string => game.users.get(userId)?.name ?? "A player";
const memberName = (caravan: CaravanState, uuid: string): string =>
  caravan.roster.find((m) => m.actorUuid === uuid)?.name ?? fromUuidSync(uuid)?.name ?? "?";

/** Rolls made while an actor's role count was different carry the wrong doubling penalty. */
function dropStaleRolls(leg: LegState, actorUuid: string, heldBefore: number): void {
  const heldAfter = engine.rolesHeldBy(actorUuid, leg.assignments).length;
  if (heldBefore >= 2 !== heldAfter >= 2) leg.rolls = leg.rolls.filter((r) => r.actorUuid !== actorUuid);
}

const claimRole: Handler<"claimRole"> = async (req, userId) => {
  const before = store.getCaravan();
  const leg = before.leg;
  if (!leg || leg.status !== "muster") return fail("No leg is mustering");
  if (!store.getRoles().some((r) => r.id === req.roleId)) return fail("Unknown role");
  if (!before.roster.some((m) => m.actorUuid === req.actorUuid)) return fail("Actor is not in the caravan");
  if (!ownsActor(userId, fromUuidSync(req.actorUuid))) return fail("You do not own that actor");
  const holder = leg.assignments.find((a) => a.roleId === req.roleId);
  if (holder?.actorUuid === req.actorUuid) return { ok: true };
  // First claim holds; a player's competing claim becomes a request the GM settles (DESIGN §4.13).
  if (holder && !game.users.get(userId)?.isGM) {
    await whisperGM(
      `<p>${escapeHtml(userName(userId))} asks to take <strong>${escapeHtml(roleName(req.roleId))}</strong> from ` +
        `${escapeHtml(memberName(before, holder.actorUuid))} with ${escapeHtml(memberName(before, req.actorUuid))}. ` +
        `Claim it for them from the Travel window to reassign.</p>`,
    );
    return fail("Role is held; the GM has been asked");
  }
  const after = clone(before);
  const legAfter = after.leg!;
  const heldBefore = engine.rolesHeldBy(req.actorUuid, legAfter.assignments).length;
  if (holder) {
    // GM reassignment: the old holder loses the role and its roll.
    const oldHeld = engine.rolesHeldBy(holder.actorUuid, legAfter.assignments).length;
    legAfter.assignments = legAfter.assignments.filter((a) => a.roleId !== req.roleId);
    legAfter.rolls = legAfter.rolls.filter((r) => !(r.roleId === req.roleId && r.actorUuid === holder.actorUuid));
    dropStaleRolls(legAfter, holder.actorUuid, oldHeld);
  }
  legAfter.assignments.push({ roleId: req.roleId, actorUuid: req.actorUuid });
  dropStaleRolls(legAfter, req.actorUuid, heldBefore);
  await commit(`Claim ${roleName(req.roleId)}`, before, after);
  return { ok: true };
};

const releaseRole: Handler<"releaseRole"> = async (req, userId) => {
  const before = store.getCaravan();
  const leg = before.leg;
  if (!leg || leg.status !== "muster") return fail("No leg is mustering");
  if (!leg.assignments.some((a) => a.roleId === req.roleId && a.actorUuid === req.actorUuid)) return fail("Not assigned");
  if (!ownsActor(userId, fromUuidSync(req.actorUuid))) return fail("You do not own that actor");
  const after = clone(before);
  const legAfter = after.leg!;
  const heldBefore = engine.rolesHeldBy(req.actorUuid, legAfter.assignments).length;
  const mine = (x: { roleId: string; actorUuid: string }) => x.roleId === req.roleId && x.actorUuid === req.actorUuid;
  legAfter.assignments = legAfter.assignments.filter((a) => !mine(a));
  legAfter.rolls = legAfter.rolls.filter((r) => !mine(r));
  dropStaleRolls(legAfter, req.actorUuid, heldBefore);
  await commit(`Release ${roleName(req.roleId)}`, before, after);
  return { ok: true };
};

const submitRoleRoll: Handler<"submitRoleRoll"> = async (req, userId) => {
  const before = store.getCaravan();
  const leg = before.leg;
  if (!leg || leg.status !== "muster") return fail("No leg is mustering");
  if (!leg.assignments.some((a) => a.roleId === req.roleId && a.actorUuid === req.actorUuid)) return fail("Not assigned");
  if (!ownsActor(userId, fromUuidSync(req.actorUuid))) return fail("You do not own that actor");
  const after = clone(before);
  const rolls = after.leg!.rolls.filter((r) => !(r.roleId === req.roleId && r.actorUuid === req.actorUuid));
  rolls.push({ roleId: req.roleId, actorUuid: req.actorUuid, total: req.total });
  after.leg!.rolls = rolls;
  await commit(`${roleName(req.roleId)} roll`, before, after);
  return { ok: true };
};

const submitSave: Handler<"submitSave"> = async (req, userId) => {
  const before = store.getCaravan();
  const leg = before.leg;
  if (!leg || leg.status !== "underway") return fail("No leg is underway");
  const actor = fromUuidSync(req.actorUuid);
  if (!ownsActor(userId, actor)) return fail("You do not own that actor");
  const owed = (l: LegState) => l.saves.find((s) => s.actorUuid === req.actorUuid && s.day === req.day && s.total === null);
  if (!owed(leg)) return fail("No save owed");
  await step(`Forced-march save (${actor?.name ?? "?"})`, before, async (after, changes) => {
    const save = owed(after.leg!)!;
    save.total = req.total;
    if (req.total < save.dc && actor) await applyFatigue(actor, changes);
  });
  return { ok: true };
};

const preserveChoice: Handler<"preserveChoice"> = async (req, userId) => {
  const before = store.getCaravan();
  const leg = before.leg;
  if (!leg || leg.status !== "underway" || !leg.outcome) return fail("No leg is underway");
  const day = leg.outcome.days.find((d) => d.day === req.day);
  if (!day?.preserveChoice) return fail("No preserve choice that day");
  if (day.day <= leg.dayIndex) return fail("That day has passed");
  // The choice belongs to whoever earned it: the holder of a successful preserve-one role.
  const roles = store.getRoles();
  const choosers = leg.outcome.roles
    .filter((o) => o.success && o.actorUuid && roles.find((r) => r.id === o.roleId)?.success.some((e) => e.type === "preserveOne"))
    .map((o) => o.actorUuid!);
  const allowed = choosers.length
    ? choosers.some((uuid) => ownsActor(userId, fromUuidSync(uuid)))
    : !!game.users.get(userId)?.isGM;
  if (!allowed) return fail("You do not own that actor");
  const after = clone(before);
  after.leg!.preserveChoices[req.day] = req.track;
  await commit(`Preserve ${req.track} (day ${req.day})`, before, after);
  return { ok: true };
};

// Off-route proposals from players (ROADMAP 1.2). Not a contract Request variant, so typed locally.
export interface PathProposal {
  userId: string;
  from: HexKey;
  path: HexKey[];
}
type ProposePathRequest = { type: "proposePath"; from: HexKey; path: HexKey[] };
let proposal: PathProposal | null = null;

function validPath(from: unknown, path: unknown): path is HexKey[] {
  if (typeof from !== "string" || !Array.isArray(path) || !path.length) return false;
  const columns = !!canvas?.grid?.columns;
  const even = !!canvas?.grid?.even;
  let prev = from;
  for (const key of path) {
    if (typeof key !== "string" || !engine.hexAdjacent(prev, key, columns, even)) return false;
    prev = key;
  }
  return true;
}

async function proposePath(req: ProposePathRequest, userId: string): Promise<RequestResult> {
  if (store.getCaravan().leg) return fail("A leg is already active");
  if (!validPath(req.from, req.path)) return fail("That path is not a chain of adjacent hexes");
  proposal = { userId, from: req.from, path: [...req.path] };
  await whisperGM(
    `<p>${escapeHtml(userName(userId))} proposes an off-route path of ${req.path.length} hex(es). ` +
      `Approve or dismiss it in the Travel window.</p>`,
  );
  store.notify();
  return { ok: true };
}

/** The GM's pending off-route proposal, if any. */
export function pendingProposal(): PathProposal | null {
  return proposal ? { ...proposal, path: [...proposal.path] } : null;
}

/** Player: send a plotted off-route path to the GM for approval. */
export function sendPathProposal(from: HexKey, path: HexKey[]): Promise<RequestResult> {
  const request: ProposePathRequest = { type: "proposePath", from, path };
  return authority.send(request as unknown as Request);
}

/** GM: start the proposed path as a leg, or drop it. */
export async function settleProposal(approve: boolean): Promise<void> {
  if (!gmOnly()) return;
  const p = proposal;
  proposal = null;
  if (approve && p) await travel.startLeg(engine.planFromPath(store.getMap(), p.from, p.path));
  store.notify();
}

// ---------- the controller ----------

/** Every path hex is Mapped for the party: the leg travels with no roll (DESIGN §4.3). */
function whollyMapped(plan: LegPlan, sceneId: string | null): boolean {
  if (!plan.path.length) return false;
  const knowledge = store.getPartyMap(sceneId ?? undefined).knowledge;
  return plan.path.every((k) => knowledge[k] === "mapped");
}

export const travel = {
  init() {
    const wrap = (fn: (r: any, u: string) => Promise<RequestResult>) => (r: Request, u: string) => exclusive(() => fn(r, u));
    authority.registerHandler("claimRole", wrap(claimRole));
    authority.registerHandler("releaseRole", wrap(releaseRole));
    authority.registerHandler("submitRoleRoll", wrap(submitRoleRoll));
    authority.registerHandler("submitSave", wrap(submitSave));
    authority.registerHandler("preserveChoice", wrap(preserveChoice));
    authority.registerHandler("proposePath" as Request["type"], wrap(proposePath));
  },

  startLeg: (plan: LegPlan) =>
    exclusive(async () => {
      if (!gmOnly()) return;
      const before = store.getCaravan();
      if (before.leg) return warn("A leg is already active.");
      const after = clone(before);
      after.leg = {
        id: randomId(),
        status: "muster",
        plan: clone(plan),
        assignments: [],
        rolls: [],
        outcome: null,
        dayIndex: 0,
        saves: [],
        preserveChoices: {},
      };
      after.sceneId = canvas?.scene?.id ?? after.sceneId;
      after.position ??= plan.from;
      proposal = null;
      await commit("Start leg", before, after);

      // Party view only: never name or describe a route the party doesn't know (invariant 1).
      const route = plan.routeId ? store.partyView(after.sceneId ?? undefined).routes[plan.routeId] : undefined;
      const title = route ? escapeHtml(route.name) : "an off-route path";
      const bargain = route?.bargain ? `<p><em>${escapeHtml(route.bargain)}</em></p>` : "";
      await postPublic(
        `<h3>The caravan musters</h3><p>Next leg: <strong>${title}</strong> (${plan.path.length} hexes, ${plan.difficulty}).</p>` +
          `${bargain}<p>Claim your roles and roll from the Travel window.</p>`,
      );
    }),

  cancelLeg: () =>
    exclusive(async () => {
      if (!gmOnly()) return;
      const before = store.getCaravan();
      if (!before.leg) return;
      const after = clone(before);
      after.leg = null;
      await commit("Cancel leg", before, after);
    }),

  resolveMuster: () =>
    exclusive(async () => {
      if (!gmOnly()) return;
      const before = store.getCaravan();
      const leg = before.leg;
      if (!leg || leg.status !== "muster") return warn("No leg is mustering.");
      const map = store.getMap(before.sceneId ?? undefined);
      const roles = store.getRoles();
      const roster = before.roster;
      const plan = clone(leg.plan);

      // Short of draft animals: one extra day per missing animal (DESIGN §4.7).
      const draftShort = Math.max(0, before.draftRequired - roster.filter((m) => m.draft).length);
      plan.baseDays += draftShort;

      // A wholly Mapped route needs no roll: every role resolves as a success at its DC.
      const mapped = whollyMapped(plan, before.sceneId);
      const assignments = mapped ? roles.map((r) => ({ roleId: r.id, actorUuid: `auto:${r.id}` })) : leg.assignments;
      const rolls = mapped
        ? roles.map((r) => ({ roleId: r.id, actorUuid: `auto:${r.id}`, total: legRoleDc(r, plan, map.hexes, map.regions, roster) }))
        : leg.rolls;
      const outcome = engine.resolveLeg({
        plan,
        roles,
        assignments,
        rolls,
        roster,
        hexes: map.hexes,
        regions: map.regions,
        settings: store.getSettings(),
        consecutiveForcedMarch: before.consecutiveForcedMarch,
      });
      if (mapped) {
        for (const o of outcome.roles) {
          o.actorUuid = leg.assignments.find((a) => a.roleId === o.roleId)?.actorUuid ?? null;
          o.total = null;
          o.doubled = false;
        }
      }
      const after = clone(before);
      after.leg!.outcome = outcome;
      after.leg!.status = "underway";
      await commit("Resolve muster", before, after);

      const rows = outcome.roles
        .map((r) => {
          const who = r.actorUuid ? memberName(before, r.actorUuid) : "vacant";
          const result = r.success ? "success" : "failure";
          return `<li>${escapeHtml(roleName(r.roleId))} (${escapeHtml(who)}): ${r.total ?? "—"} vs DC ${r.dc} — <strong>${result}</strong></li>`;
        })
        .join("");
      const notes = [
        mapped ? "<p>The way is wholly <strong>Mapped</strong>: no roll was needed.</p>" : "",
        draftShort ? `<p>Short ${draftShort} draft animal(s): +${draftShort} day(s).</p>` : "",
        outcome.surprised ? "<p>The scouts missed the signs: the caravan can be <strong>surprised</strong>.</p>" : "",
      ].join("");
      await postPublic(
        `<h3>The caravan sets out</h3><p>The leg will take <strong>${outcome.totalDays}</strong> day(s).</p><ul>${rows}</ul>${notes}`,
      );
      if (outcome.arrivalPrompts.length) {
        await whisperGM(`<p><strong>Prompts:</strong></p><ul>${outcome.arrivalPrompts.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`);
      }
    }),

  nextDay: () =>
    exclusive(async () => {
      if (!gmOnly()) return;
      const before = store.getCaravan();
      const leg = before.leg;
      const outcome = leg?.outcome;
      if (!leg || leg.status !== "underway" || !outcome) return warn("No leg is underway.");
      const day = outcome.days[leg.dayIndex];
      if (!day) return warn("The leg has no days left.");

      await step(`Day ${day.day}`, before, async (after, changes) => {
        const legAfter = after.leg!;

        // Supplies (a Forager success keeps one track whole today; water by default).
        const preserved = day.preserveChoice ? (leg.preserveChoices[day.day] ?? "water") : null;
        for (const track of ["rations", "water"] as const) {
          if (track === preserved) continue;
          const amount = day.drain[track];
          if (amount <= 0) continue;
          const unpaid = await drainTrack(track, amount, changes);
          if (unpaid > 0) await applyAtZero(track, after.roster, changes);
        }

        // Wagon.
        const wagonBefore = after.wagon.condition;
        after.wagon.condition = Math.max(0, Math.min(after.wagon.max, wagonBefore - day.drain.wagon));
        if (after.wagon.condition === 0 && wagonBefore > 0) await whisperGM("<p><strong>The wagon is broken</strong> (Condition 0).</p>");

        // Token and position.
        await moveToken(after.sceneId, day.hex, changes);
        after.position = day.hex;

        if (day.forcedMarchDc !== null) await forcedMarch(day, legAfter, after.roster, changes);

        await game.time.advance(DAY_SECONDS);
        changes.push({ kind: "worldTime", seconds: DAY_SECONDS });

        after.journeyDay += 1;
        legAfter.dayIndex += 1;
        after.consecutiveForcedMarch = day.forcedMarchDc !== null ? after.consecutiveForcedMarch + 1 : 0;

        // Messages change no world state, so they go last.
        await encounter(before, day, outcome.surprised);
        if (day.prompts.length) {
          await whisperGM(`<p><strong>Day ${day.day}:</strong></p><ul>${day.prompts.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`);
        }
        // The leg stays underway after its last day so owed saves can still be rolled; the GM arrives.
      });
    }),

  arrive: () =>
    exclusive(async () => {
      if (!gmOnly()) return;
      const before = store.getCaravan();
      const leg = before.leg;
      if (!leg?.outcome) return warn("No leg is underway.");
      const owed = leg.saves.filter((s) => s.total === null);
      if (owed.length) {
        const names = [...new Set(owed.map((s) => memberName(before, s.actorUuid)))].join(", ");
        return warn(`Waiting on forced-march saves from ${names}. Roll them from the Travel window first.`);
      }
      await step("Arrive", before, async (after, changes) => {
        changes.push(...(await arrivalChanges(after)));
      });
      await postPublic("<h3>Arrived</h3><p>The caravan reaches the end of the leg.</p>");
    }),

  undo: () =>
    exclusive(async () => {
      if (!gmOnly()) return;
      const entry = await ledger.undoLast();
      store.notify();
      if (entry) notifications()?.info(`Undid: ${entry.label}`);
      else warn("Nothing to undo.");
    }),

  async rollRole(roleId: string, actorUuid: string) {
    const leg = store.getCaravan().leg;
    if (!leg || leg.status !== "muster") return warn("No leg is mustering.");
    const actor = fromUuidSync(actorUuid);
    const role = store.getRoles().find((r) => r.id === roleId);
    if (!actor || !role) return warn("Unknown actor or role.");
    const skill = pf1Adapter.bestSkill(actor, role.skills);
    const penalty = engine.doublingPenalty(actorUuid, leg.assignments, store.getSettings());
    const flavor = `${role.name}: ${pf1Adapter.skillLabel(skill)}${penalty ? ` (−${penalty} doubling)` : ""}`;
    const total = await pf1Adapter.rollSkill(actor, skill, penalty, flavor);
    if (total === null) return;
    const result = await authority.send({ type: "submitRoleRoll", roleId, actorUuid, total });
    if (!result.ok) warn(result.error ?? "The roll was not accepted.");
  },

  async rollSave(actorUuid: string, day: number) {
    const leg = store.getCaravan().leg;
    const save = leg?.saves.find((s) => s.actorUuid === actorUuid && s.day === day && s.total === null);
    if (!save) return warn("No save owed.");
    const actor = fromUuidSync(actorUuid);
    if (!actor) return warn("Unknown actor.");
    const total = await pf1Adapter.rollFort(actor, `Forced march (DC ${save.dc})`);
    if (total === null) return;
    const result = await authority.send({ type: "submitSave", actorUuid, day, total });
    if (!result.ok) warn(result.error ?? "The save was not accepted.");
  },
} satisfies TravelApi;

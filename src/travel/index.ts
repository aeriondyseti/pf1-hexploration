// Travel controller (DESIGN §4.5–§4.13): the shared plan, GM approval, and the day step — auto-rolls
// every role, applies the engine's outcome, posts one summary card and whispers the encounter to the GM.
import type { TravelApi } from "../contracts";
import { authority } from "../authority";
import { exclusive } from "../caravan";
import { engine } from "../engine";
import { undo } from "../ledger";
import { foundryRoller, pf1Adapter } from "../pf1";
import { store } from "../store";
import {
  TERRAIN_RULES,
  type Activity,
  type CaravanState,
  type DayOutcome,
  type DayPreview,
  type HexKey,
  type KnowledgeState,
  type Request,
  type RequestResult,
  type SupplyTrack,
} from "../types";
import { buildDayContext } from "./context";

const DAY_SECONDS = 86400;
const ACTIVITIES: Activity[] = ["travel", "explore", "forage", "rest"];
const ACTIVITY_LABEL: Record<Activity, string> = { travel: "Travel", explore: "Explore", forage: "Forage", rest: "Rest" };

const clone = <T>(v: T): T => structuredClone(v);
const notifications = (): any => (globalThis as any).ui?.notifications;
const fail = (error: string): RequestResult => ({ ok: false, error });

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function gmOnly(): boolean {
  if (game.user?.isGM) return true;
  notifications()?.warn("PF1 Hexploration: only the GM can do that.");
  return false;
}

function gmIds(): string[] {
  return Array.from<any>(game.users).filter((u) => u.isGM).map((u) => u.id);
}

async function whisperGM(content: string): Promise<void> {
  const ids = gmIds();
  if (ids.length) await ChatMessage.create({ content, whisper: ids });
}

function actorOf(uuid: string | null | undefined): any | null {
  if (!uuid) return null;
  try {
    return fromUuidSync(uuid) ?? null;
  } catch {
    return null;
  }
}

function coinText(cp: number): string {
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  return [gp && `${gp} gp`, sp && `${sp} sp`, c && `${c} cp`].filter(Boolean).join(" ") || "0 cp";
}

function parseKey(key: HexKey): { i: number; j: number } {
  const [i, j] = key.split(",").map(Number);
  return { i, j };
}

/** Is `course` a chain of adjacent hexes starting next to `from`? */
export function validCourse(from: HexKey | null, course: unknown): course is HexKey[] {
  if (!Array.isArray(course)) return false;
  if (!course.length) return true;
  if (!from) return false;
  const columns = !!canvas?.grid?.columns;
  const even = !!canvas?.grid?.even;
  let prev = from;
  for (const key of course) {
    if (typeof key !== "string" || !engine.hexAdjacent(prev, key, columns, even)) return false;
    prev = key;
  }
  return true;
}

// ---------- the day step's writes ----------

/** Remove person-days from a track's vehicle supplies, loose first. Returns the drain left unpaid. */
async function drainTrack(track: SupplyTrack, amount: number): Promise<number> {
  let remaining = Math.ceil(amount - 1e-9); // whole items (TD-0004)
  for (const supply of store.supplyItems()) {
    if (remaining <= 0) break;
    if (supply.track !== track) continue;
    const before = Number(supply.item.system?.quantity ?? 0);
    if (before <= 0) continue;
    const per = supply.unitsPerQuantity > 0 ? supply.unitsPerQuantity : 1;
    const take = Math.min(before, Math.ceil(remaining / per - 1e-9));
    remaining = Math.max(0, remaining - take * per);
    await store.setSupplyQuantity(supply, before - take);
  }
  return remaining;
}

/** Use up repair materials worth `cost` cp from the vehicles (whole units, in inventory order).
 *  Returns false, using nothing, when they're worth less than that. */
async function useRepairMaterials(cost: number): Promise<boolean> {
  const items = store.repairItems().filter((r) => r.unitValue > 0 && Number(r.item.system?.quantity) > 0);
  if (items.reduce((sum, r) => sum + r.unitValue * Number(r.item.system.quantity), 0) < cost) return false;
  let remaining = cost;
  for (const r of items) {
    if (remaining <= 0) break;
    const qty = Number(r.item.system.quantity);
    const take = Math.min(qty, Math.ceil(remaining / r.unitValue));
    remaining -= take * r.unitValue;
    const after = qty - take;
    if (r.container) await r.container.updateContainerContents([{ _id: r.item.id, "system.quantity": after }]);
    else await r.item.update({ "system.quantity": after });
  }
  return true;
}

async function moveToken(sceneId: string | null, hex: HexKey): Promise<void> {
  const actor = store.getCaravanActor();
  const scene = sceneId ? game.scenes?.get(sceneId) : canvas?.scene;
  if (!actor || !scene) return;
  const viewed = scene.id === canvas?.scene?.id;
  const grid = viewed ? canvas?.grid : scene.grid;
  if (!grid?.getCenterPoint) return;
  const token = Array.from<any>(scene.tokens ?? []).find((t) => t.actorId === actor.id);
  if (!token) return;
  const center = grid.getCenterPoint(parseKey(hex));
  const size = (viewed ? token.object?.getSize?.() : null) ?? {
    width: token.width * (grid.sizeX ?? grid.size),
    height: token.height * (grid.sizeY ?? grid.size),
  };
  const x = center.x - size.width / 2;
  const y = center.y - size.height / 2;
  if (token.x !== x || token.y !== y) await token.update({ x, y });
}

async function encounterText(table: string | null, total: number): Promise<string> {
  if (!table) return "";
  try {
    const t = await fromUuid(table);
    const results: any[] = t?.getResultsForRoll?.(total) ?? [];
    return results.map((r) => r.description || r.name || r.text || "").filter(Boolean).join("; ");
  } catch (err) {
    console.error("pf1-hexploration | encounter table lookup failed", err);
    return "";
  }
}

const isNothing = (text: string) => !text.trim() || /^\s*(nothing|no encounter|none|—|-)\.?\s*$/i.test(text.replace(/<[^>]*>/g, ""));

/** Roll every check that needs a roll, from each holder's sheet with no dialog. Raw totals before penalty. */
async function rollChecks(preview: DayPreview): Promise<Record<string, number | null>> {
  const totals: Record<string, number | null> = {};
  for (const check of preview.checks) {
    if (check.auto || !check.actorUuid) continue;
    const actor = actorOf(check.actorUuid);
    if (!actor) {
      totals[check.id] = null;
      continue;
    }
    const skill = pf1Adapter.bestSkill(actor, check.skills);
    const total = await pf1Adapter.rollSkill(actor, skill, check.penalty);
    if (total === null) {
      await whisperGM(`<p><strong>${esc(check.label)}:</strong> ${esc(actor.name)}'s roll returned no readable total; it counts as a failure.</p>`);
      totals[check.id] = null;
    } else totals[check.id] = total + check.penalty; // the engine applies the penalty itself
  }
  return totals;
}

function summaryCard(day: number, activity: Activity, out: DayOutcome, extra: string[]): string {
  const rows = out.checks
    .map((c) => {
      const who = c.actorUuid ? esc(actorOf(c.actorUuid)?.name ?? "?") : "<em>vacant</em>";
      const result = c.auto ? "road: no check" : c.total === null ? "—" : `${c.total} vs DC ${c.dc}`;
      const mark = c.success ? "✔" : "✘";
      return `<tr><td>${esc(c.label)}</td><td>${who}</td><td>${result}</td><td class="${c.success ? "pf1hex-ok" : "pf1hex-bad"}">${mark}</td></tr>`;
    })
    .join("");
  const lines: string[] = [];
  if (activity === "travel") {
    if (out.lost) lines.push("The Navigator lost the way: no progress today.");
    else if (out.moved.length) lines.push(`Moved ${out.moved.length} hex${out.moved.length === 1 ? "" : "es"}.`);
    else if (out.pace.blocked) lines.push(`The caravan can't move: ${esc(out.pace.blocked)}.`);
  }
  const drained = [
    out.drain.rations ? `rations −${Math.ceil(out.drain.rations - 1e-9)}` : "",
    out.drain.water ? `water −${Math.ceil(out.drain.water - 1e-9)}` : "",
  ].filter(Boolean);
  if (drained.length) lines.push(`Supplies: ${drained.join(", ")}.`);
  if (out.preserved.length) lines.push(`The Forager kept the ${out.preserved.join(" and ")} undrained.`);
  for (const w of out.wear) lines.push(`${esc(actorOf(w.vehicleUuid)?.name ?? "Vehicle")} takes ${w.damage} wear (${w.dice}).`);
  if (out.repair) lines.push(`Repairs: +${out.repair.hp} HP to ${esc(actorOf(out.repair.vehicleUuid)?.name ?? "the vehicle")} (${coinText(out.repair.cost)} of Repair Materials used).`);
  if (out.longTermCare) lines.push("Long-term care tonight: up to six travellers heal double.");
  if (out.revealed) lines.push("The hex is fully explored.");
  lines.push(...extra);
  return `<div class="pf1hex-card"><h3>Day ${day} · ${ACTIVITY_LABEL[activity]}</h3>
<table class="pf1hex-checks"><tbody>${rows}</tbody></table>
${lines.map((l) => `<p>${l}</p>`).join("")}</div>`;
}

let lastEncounter = false;

async function runDay(): Promise<DayOutcome | null> {
  const before = store.getCaravan();
  const trip = before.trip;
  if (!trip) {
    notifications()?.warn("No trip is underway. Approve a plan first.");
    return null;
  }
  if (!before.position) {
    notifications()?.warn("Place the caravan on the map first.");
    return null;
  }
  const ctx = buildDayContext(false);
  const preview = engine.dayPreview(ctx);
  if (trip.activity === "travel" && preview.pace.blocked) {
    notifications()?.warn(`The caravan can't move: ${preview.pace.blocked}.`);
    return null;
  }

  const totals = await rollChecks(preview);
  await undo.capture(`Day ${before.journeyDay + 1}`);
  const out = engine.resolveDay(ctx, totals, foundryRoller);
  const after: CaravanState = clone(before);
  const extra: string[] = [];

  // Supplies and wages.
  for (const track of ["rations", "water"] as SupplyTrack[]) {
    const short = await drainTrack(track, out.drain[track]);
    if (short > 0) extra.push(`<strong>Out of ${track}:</strong> ${short} person-day${short === 1 ? "" : "s"} short.`);
  }
  if (out.wages > 0) {
    const paid = Math.min(after.funds, out.wages);
    after.funds -= paid;
    extra.push(`Wages: ${coinText(paid)} paid.`);
    if (paid < out.wages) await whisperGM(`<p><strong>Wages short:</strong> ${coinText(out.wages - paid)} unpaid today; party funds are empty.</p>`);
  }
  // Vehicles.
  for (const w of out.wear) {
    const a = actorOf(w.vehicleUuid);
    if (a && w.damage > 0) await pf1Adapter.setVehicleHp(a, pf1Adapter.vehicleHp(a).hp - w.damage);
  }
  if (out.repair) {
    const a = actorOf(out.repair.vehicleUuid);
    if (a && (await useRepairMaterials(out.repair.cost))) {
      const { hp, maxHp } = pf1Adapter.vehicleHp(a);
      await pf1Adapter.setVehicleHp(a, Math.min(maxHp, hp + out.repair.hp));
    } else out.repair = null;
  } else if (trip.activity === "rest" && ctx.repairStock < 1000 && out.checks.some((ch) => ch.roleId === "wainwright" && ch.actorUuid)) {
    extra.push(`No repairs: the vehicles carry less than 10 gp of Repair Materials (${coinText(ctx.repairStock)}).`);
  }
  // Map knowledge.
  const sceneId = before.sceneId ?? canvas?.scene?.id ?? null;
  if (sceneId) {
    const byState: Partial<Record<KnowledgeState, HexKey[]>> = {};
    for (const [key, state] of Object.entries(out.knowledge)) (byState[state] ??= []).push(key);
    for (const [state, keys] of Object.entries(byState)) await store.setKnowledge(sceneId, keys!, state as KnowledgeState);
    if (out.revealed) {
      const party = store.getPartyMap(sceneId);
      party.revealed = [...new Set([...(party.revealed ?? []), out.revealed])];
      await store.setPartyMap(sceneId, party);
    }
  }
  // Position, trip and time.
  after.position = out.end;
  after.journeyDay += 1;
  const nextTrip = { ...trip, day: trip.day + 1, course: trip.course.slice(out.moved.length) };
  if (trip.activity === "explore") nextTrip.exploreDays = trip.exploreDays + 1;
  after.trip = out.done ? null : nextTrip;
  if (out.done) extra.push(trip.activity === "travel" ? "<strong>The caravan has arrived.</strong>" : "The activity is done.");
  if (out.moved.length) await moveToken(sceneId, out.end);
  await store.setCaravan(after);
  await game.time.advance(DAY_SECONDS);
  await undo.recordTime(DAY_SECONDS, after.funds);

  // Cards: the public summary, and the encounter for the GM only (invariant 1).
  await ChatMessage.create({ content: summaryCard(after.journeyDay, trip.activity, out, extra) });
  const text = await encounterText(out.encounter.table, out.encounter.total);
  lastEncounter = !!out.encounter.table && !isNothing(text);
  await whisperGM(
    `<p><strong>Day ${after.journeyDay} encounter check:</strong> ${out.encounter.total} ` +
      `(d20 ${out.encounter.d20} + ${out.encounter.bonus})${out.surprised ? " — the caravan would be <em>surprised</em>" : ""}.</p>` +
      (text ? `<p>${text}</p>` : out.encounter.table ? "" : "<p><em>No encounter table for this hex.</em></p>"),
  );
  store.notify();
  return out;
}

// ---------- requests ----------

type SetPlanRequest = Extract<Request, { type: "setPlan" }>;

async function setPlanHandler(req: SetPlanRequest, userId: string): Promise<RequestResult> {
  return exclusive(async () => {
    const before = store.getCaravan();
    if (before.trip) return fail("A trip is underway; ask the GM to stop it first.");
    if (!ACTIVITIES.includes(req.activity)) return fail("Unknown activity");
    if (!validCourse(before.position, req.course)) return fail("That course is not a chain of adjacent hexes from the caravan");
    const after = clone(before);
    after.plan = {
      activity: req.activity,
      course: req.activity === "travel" ? [...req.course] : [],
      routeId: req.activity === "travel" ? req.routeId : null,
      lastEdit: { user: game.users.get(userId)?.name ?? "Someone", text: String(req.text ?? "").slice(0, 120) },
    };
    await store.setCaravan(after);
    return { ok: true };
  });
}

async function askStopHandler(_req: Request, userId: string): Promise<RequestResult> {
  await whisperGM(`<p>${esc(game.users.get(userId)?.name ?? "A player")} asks to stop the caravan.</p>`);
  return { ok: true };
}

export const travel = {
  init() {
    authority.registerHandler("setPlan", (req, userId) => setPlanHandler(req as SetPlanRequest, userId));
    authority.registerHandler("askStop", askStopHandler);
  },

  setPlan(plan: { activity: Activity; course: HexKey[]; routeId: string | null }, text: string) {
    return authority.send({ type: "setPlan", activity: plan.activity, course: plan.course, routeId: plan.routeId, text });
  },

  async approve() {
    if (!gmOnly()) return;
    await exclusive(async () => {
      const before = store.getCaravan();
      if (before.trip) return notifications()?.warn("A trip is already underway.");
      if (!before.position) return notifications()?.warn("Place the caravan on the map first.");
      const plan = before.plan;
      if (plan.activity === "travel" && !plan.course.length) return notifications()?.warn("The plan has no course. Plot one first.");
      if (plan.activity === "travel" && !validCourse(before.position, plan.course))
        return notifications()?.warn("The course no longer starts at the caravan's hex. Plot it again.");
      const after = clone(before);
      after.trip = { activity: plan.activity, course: [...plan.course], day: 0, exploreDays: 0 };
      after.plan = { activity: plan.activity, course: [], routeId: null, lastEdit: null };
      await store.setCaravan(after);
      const what =
        plan.activity === "travel"
          ? `sets out on a ${plan.course.length}-hex course`
          : plan.activity === "explore"
            ? "stays to explore this hex"
            : plan.activity === "forage"
              ? "stays a day to forage"
              : "makes camp to rest";
      await ChatMessage.create({ content: `<p><strong>The caravan ${what}.</strong></p>` });
    });
  },

  async nextDay() {
    if (!gmOnly()) return null;
    return exclusive(() => runDay());
  },

  async travelAll() {
    if (!gmOnly()) return;
    for (let i = 0; i < 60; i++) {
      const out = await exclusive(() => runDay());
      if (!out || !store.getCaravan().trip) break;
      if (lastEncounter) {
        notifications()?.info("Travel all stopped: an encounter turned up.");
        break;
      }
      if (out.pace.blocked) break;
      if (out.lost || (store.getCaravan().trip?.activity === "travel" && !out.moved.length)) {
        notifications()?.info("Travel all stopped: the caravan made no progress today.");
        break;
      }
    }
  },

  async stop() {
    if (!gmOnly()) return;
    await exclusive(async () => {
      const after = clone(store.getCaravan());
      if (!after.trip) return;
      after.trip = null;
      await store.setCaravan(after);
      await ChatMessage.create({ content: "<p><strong>The caravan halts.</strong></p>" });
    });
  },

  async undo() {
    if (!gmOnly()) return;
    await exclusive(async () => {
      const label = await undo.undo();
      if (label) notifications()?.info(`Undid ${label}.`);
      else notifications()?.warn("Nothing to undo.");
    });
  },

  preview(): DayPreview | null {
    const c = store.getCaravan();
    if (!c.position) return null;
    try {
      return engine.dayPreview(buildDayContext());
    } catch (err) {
      console.error("pf1-hexploration | preview failed", err);
      return null;
    }
  },
} satisfies TravelApi;

/** Days a course should take at today's pace (whole hexes, at least one a day). */
export function estimateDays(course: HexKey[]): number {
  if (!course.length) return 0;
  const p = travel.preview();
  const perDay = p?.moving ? Math.max(1, p.hexes.length) : 1;
  return Math.ceil(course.length / perDay);
}

/** Terrain label for the window's status line. */
export function terrainLabel(terrain: string | undefined): string {
  return terrain ? (TERRAIN_RULES[terrain as keyof typeof TERRAIN_RULES]?.label ?? terrain) : "Unknown";
}

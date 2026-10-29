// The Caravan sheet (DESIGN §4.4, the rebuild's FinalCaravan mock-up): status line, summary tiles, travellers,
// roles, vehicle cards and party funds. One render + one set of listeners serve both the Caravan window
// (scene controls) and the Caravan actor's own sheet (src/model). Everyone views; players edit only actors
// they own (each edit is an hx.caravan request the GM's client validates); the GM edits everything.
import {
  CARAVAN_TYPE,
  MODULE_ID,
  ROLE_DEFS,
  ROLE_IDS,
  TERRAIN_RULES,
  type CaravanResult,
  type CaravanState,
  type Coins,
  type RoleId,
  type SupplyTrack,
  type Traveller,
  type VehicleLink,
} from "../types";
import { store } from "../store";
import { caravan as caravanService } from "../caravan";
import { pf1Adapter } from "../pf1";
import { paceNow, vehicleInfos } from "../travel/context";
import { actorFor, attempt, canControl, cpText, dragData, esc, initials, option, signed, toast } from "./html";

// Item flag keys the store reads for supplies (src/store supplyItems).
export const SUPPLY_FLAG = "supply";
export const UNITS_FLAG = "units";

const CHIP_TYPE = "pf1hex-traveller";
const LOW_DAYS = 3;

// ---------- the window ----------

let CaravanApp: any = null;

export function caravanAppClass(): any {
  if (CaravanApp) return CaravanApp;
  const { ApplicationV2 } = foundry.applications.api;

  CaravanApp = class extends (ApplicationV2 as any) {
    sheetState: SheetState = newSheetState();
    unsubscribe: (() => void) | null = null;

    static DEFAULT_OPTIONS = {
      id: "pf1hex-caravan",
      classes: ["pf1hex", "pf1hex-caravan"],
      window: { title: "Caravan", resizable: true, icon: "fa-solid fa-horse" },
      position: { width: 980, height: 760 },
      actions: SHEET_ACTIONS,
    };

    async _renderHTML(): Promise<string> {
      return renderCaravanSheet(this);
    }

    _replaceHTML(result: string, content: HTMLElement): void {
      content.innerHTML = result;
    }

    async _onFirstRender(...args: any[]): Promise<void> {
      await super._onFirstRender?.(...args);
      this.unsubscribe = store.onChange(sheetRerenderer(this));
      bindCaravanSheet(this, this.element);
    }

    _onRender(...args: any[]): void {
      super._onRender?.(...args);
      restoreKept(this);
    }

    _onClose(...args: any[]): void {
      super._onClose?.(...args);
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  };
  return CaravanApp;
}

// ---------- sheet state kept across re-renders (KtP #25) ----------

export interface SheetState {
  funds: "deposit" | "withdraw" | null;
  kept: Record<string, string>;
  pending: boolean;
}

export function newSheetState(): SheetState {
  return { funds: null, kept: {}, pending: false };
}

function stateOf(app: any): SheetState {
  return (app.sheetState ??= newSheetState());
}

/** Remember unsaved `[data-keep]` inputs (the funds form) before the DOM is replaced. */
function captureKept(app: any): void {
  const el: HTMLElement | null = app.element ?? null;
  if (!el?.querySelectorAll) return;
  const kept = stateOf(app).kept;
  for (const input of Array.from(el.querySelectorAll<HTMLInputElement>("[data-keep]"))) kept[input.name] = input.value;
}

export function restoreKept(app: any): void {
  const el: HTMLElement | null = app.element ?? null;
  if (!el?.querySelectorAll) return;
  const kept = stateOf(app).kept;
  for (const input of Array.from(el.querySelectorAll<HTMLInputElement>("[data-keep]"))) {
    if (kept[input.name] !== undefined) input.value = kept[input.name];
  }
}

/**
 * Re-render on store changes, coalesced; while the user is typing in or picking from a field on the sheet,
 * wait until it loses focus so a store change never resets an in-progress edit.
 */
export function sheetRerenderer(app: any): () => void {
  let queued = false;
  const flush = () => {
    queued = false;
    if (!app.rendered) return;
    const el: HTMLElement | null = app.element ?? null;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (el && active && el.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) {
      stateOf(app).pending = true;
      return;
    }
    app.render();
  };
  return () => {
    if (queued) return;
    queued = true;
    queueMicrotask(flush);
  };
}

// ---------- rendering ----------

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString();
const ACTIVITY_LABEL: Record<string, string> = { travel: "Travelling", explore: "Exploring", forage: "Foraging", rest: "Resting" };

interface Tile {
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
  extra?: string;
}

function tile(t: Tile): string {
  return `<div class="pf1hex-tile${t.warn ? " warn" : ""}"><div class="pf1hex-tile-label">${esc(t.label)}</div>
<div class="pf1hex-tile-value">${esc(t.value)}</div><div class="pf1hex-tile-sub">${esc(t.sub)}</div>${t.extra ?? ""}</div>`;
}

function chip(uuid: string, name: string, removeAction?: string, data = ""): string {
  const actor = actorFor(uuid);
  const drag = canControl(actor) ? ` draggable="true" data-chip="${esc(uuid)}"` : "";
  const remove = removeAction && canControl(actor)
    ? `<button type="button" class="pf1hex-chip-x" data-action="${removeAction}" data-uuid="${esc(uuid)}"${data} aria-label="Remove ${esc(name)}"><i class="fa-solid fa-xmark"></i></button>`
    : "";
  return `<span class="pf1hex-chip"${drag}><span class="pf1hex-avatar">${esc(initials(name))}</span><span class="pf1hex-chip-name">${esc(name)}</span>${remove}</span>`;
}

function statusLine(c: CaravanState): string {
  const parts: string[] = [c.trip ? (ACTIVITY_LABEL[c.trip.activity] ?? c.trip.activity) : "Camped"];
  if (c.position) {
    const map = game.user?.isGM ? store.getMap(c.sceneId ?? undefined) : store.partyView(c.sceneId ?? undefined);
    const hex = map.hexes[c.position];
    if (hex) {
      const region = hex.region ? map.regions[hex.region]?.name : null;
      parts.push([TERRAIN_RULES[hex.terrain]?.label ?? hex.terrain, region].filter(Boolean).join(", "));
    } else parts.push("Unknown hex");
  } else parts.push("Not on the map");
  parts.push(`Day ${c.journeyDay}`);
  if (c.trip) parts.push(`trip day ${c.trip.day + 1}`);
  return parts.join(" · ");
}

/** What a traveller is doing with the vehicles: driving, pulling, riding or walking. */
function travelsIn(c: CaravanState, t: Traveller): { kind: "drive" | "pull" | "seat" | "foot"; vehicle: VehicleLink | null } {
  for (const v of c.vehicles) if (v.driver === t.actorUuid) return { kind: "drive", vehicle: v };
  for (const v of c.vehicles) if (v.team.includes(t.actorUuid)) return { kind: "pull", vehicle: v };
  const seat = t.seat ? c.vehicles.find((v) => v.actorUuid === t.seat) ?? null : null;
  return seat ? { kind: "seat", vehicle: seat } : { kind: "foot", vehicle: null };
}

function rolesOf(c: CaravanState, uuid: string): string[] {
  const out = ROLE_IDS.filter((id) => c.roles[id] === uuid).map((id) => ROLE_DEFS[id].name);
  for (const v of c.vehicles) if (v.driver === uuid) out.push(`Driver (${v.name})`);
  return out;
}

function playerNames(actor: any): string {
  if (!actor) return "—";
  const ids = pf1Adapter.playerOwners(actor);
  const names = ids.map((id) => game.users?.get(id)?.name).filter(Boolean);
  return names.length ? names.join(", ") : "GM";
}

export function renderCaravanSheet(app: any): string {
  captureKept(app);
  const gm = !!game.user?.isGM;
  const c = store.getCaravan();
  const caravanActor = store.getCaravanActor();
  const state = stateOf(app);

  // --- GM: which caravan ---
  const caravans: any[] = (game.actors?.contents ?? []).filter((a: any) => a.type === CARAVAN_TYPE);
  const gmBar = gm
    ? `<div class="pf1hex-row pf1hex-gmbar">
  <select name="caravanActor">${[option("", "— no caravan —"), ...caravans.map((a) => option(a.uuid, a.name, a.uuid === caravanActor?.uuid))].join("")}</select>
  <button type="button" data-action="setActor">Set</button>
  <button type="button" data-action="createCaravan"><i class="fa-solid fa-plus"></i> New caravan</button>
  ${caravanActor ? `<button type="button" data-action="placeToken"><i class="fa-solid fa-location-dot"></i> Place on map</button>` : ""}
</div>`
    : "";
  if (!caravanActor) {
    return `${gmBar}<p class="pf1hex-note">${gm ? "Create or choose a caravan to start." : "The GM hasn't set up a caravan yet."}</p>`;
  }

  const header = `<header class="pf1hex-sheet-head">
  <img class="pf1hex-sheet-img" src="${esc(caravanActor.img ?? "")}" alt="">
  <div class="pf1hex-grow"><div class="pf1hex-sheet-name">${esc(caravanActor.name)}</div><div class="pf1hex-sheet-status">${esc(statusLine(c))}</div></div>
  <div class="pf1hex-sheet-hint">Drag actors or vehicles onto this sheet to add them.<br>Drag a name onto a vehicle's Driver or Pulled-by area.</div>
</header>`;

  // --- tiles ---
  const infos = vehicleInfos(c);
  const pullers = new Set(c.vehicles.flatMap((v) => v.team));
  const people = c.travellers.filter((t) => !pullers.has(t.actorUuid)).length;
  const pace = paceNow();
  const totals = store.supplyTotals();
  const food = c.travellers.reduce((s, t) => s + t.food, 0);
  const water = c.travellers.reduce((s, t) => s + t.water, 0);
  const days = (stock: number, use: number) => (use > 0 ? Math.floor(stock / use) : Infinity);
  const foodDays = days(totals.rations, food);
  const waterDays = days(totals.water, water);
  const cargo = infos.reduce((s, v) => s + v.cargo, 0);
  const capacity = infos.reduce((s, v) => s + v.cargoCapacity, 0);
  const wages = c.travellers.reduce((s, t) => s + t.wage, 0);
  const hired = c.travellers.filter((t) => t.wage > 0).length;
  const fundsButtons = `<div class="pf1hex-tile-buttons"><button type="button" data-action="openFunds" data-mode="deposit">Deposit</button><button type="button" data-action="openFunds" data-mode="withdraw">Withdraw</button></div>`;
  const tiles = [
    tile({ label: "TRAVELLERS", value: String(people), sub: `+ ${pullers.size} animals · ${c.vehicles.length} vehicles` }),
    pace
      ? tile({ label: "SPEED", value: pace.blocked ? "Stopped" : `${fmt(pace.milesPerDay)} mi`, sub: pace.blocked ?? `a day · set by ${pace.setBy}`, warn: !!pace.blocked })
      : tile({ label: "SPEED", value: "—", sub: "no pace yet" }),
    tile({
      label: "FOOD",
      value: foodDays === Infinity ? "—" : `${foodDays} days`,
      sub: `${fmt(totals.rations)} rations · ${fmt(food)} a day${foodDays < LOW_DAYS ? " · running low" : ""}`,
      warn: foodDays < LOW_DAYS,
    }),
    tile({
      label: "WATER",
      value: waterDays === Infinity ? "—" : `${waterDays} days`,
      sub: `${fmt(totals.water)} days' water · ${fmt(water)} a day${waterDays < LOW_DAYS ? " · running low" : ""}`,
      warn: waterDays < LOW_DAYS,
    }),
    tile({ label: "CARGO", value: `${fmt(cargo)} lb`, sub: `of ${fmt(capacity)} lb`, warn: cargo > capacity && capacity > 0 }),
    tile({ label: "WAGES", value: cpText(wages), sub: `a day · ${hired} hired` }),
    tile({ label: "FUNDS", value: cpText(c.funds), sub: "party funds", extra: fundsButtons }),
  ].join("");

  // --- funds form ---
  let fundsForm = "";
  if (state.funds) {
    const mine: any[] = (game.actors?.contents ?? []).filter(
      (a: any) => a.type !== CARAVAN_TYPE && !pf1Adapter.isVehicle(a) && (gm ? a.type === "character" || c.travellers.some((t) => t.actorUuid === a.uuid) : a.isOwner),
    );
    const coin = (k: keyof Coins) => `<label>${k} <input type="number" min="0" step="1" name="funds-${k}" data-keep value="0"></label>`;
    fundsForm = `<section class="pf1hex-funds-form">
  <strong>${state.funds === "deposit" ? "Deposit into party funds from" : "Withdraw from party funds to"}</strong>
  <select name="funds-actor" data-keep>${mine.map((a) => option(a.uuid, `${a.name} (${coinSummary(a)})`)).join("")}</select>
  ${coin("pp")}${coin("gp")}${coin("sp")}${coin("cp")}
  <button type="button" data-action="confirmFunds"${mine.length ? "" : " disabled"}><i class="fa-solid fa-check"></i> ${state.funds === "deposit" ? "Deposit" : "Withdraw"}</button>
  <button type="button" data-action="closeFunds">Cancel</button>
  ${mine.length ? "" : `<span class="pf1hex-note">You have no character to ${state.funds === "deposit" ? "pay from" : "pay to"}.</span>`}
</section>`;
  }

  // --- travellers ---
  const rows = c.travellers.map((t) => {
    const actor = actorFor(t.actorUuid);
    const mine = canControl(actor);
    const where = travelsIn(c, t);
    let travels: string;
    if (where.kind === "drive") travels = `<span class="pf1hex-busy">Driving the ${esc(where.vehicle!.name)}</span>`;
    else if (where.kind === "pull") travels = `<span class="pf1hex-busy">Pulling the ${esc(where.vehicle!.name)}</span>`;
    else if (mine)
      travels = `<select name="seat" data-uuid="${esc(t.actorUuid)}" aria-label="${esc(t.name)} travels in">${option("", "On foot", !t.seat)}${c.vehicles
        .map((v) => option(v.actorUuid, v.name, t.seat === v.actorUuid))
        .join("")}</select>`;
    else travels = esc(where.vehicle ? where.vehicle.name : "On foot");
    const roles = rolesOf(c, t.actorUuid);
    const rolesCell = roles.length
      ? `<span class="${roles.length > 1 ? "pf1hex-warn" : ""}">${esc(roles.join(", "))}${roles.length > 1 ? ` (−${store.getSettings().doublingPenalty} each)` : ""}</span>`
      : `<span class="pf1hex-muted">—</span>`;
    const eats = gm
      ? `<input type="number" min="0" step="0.1" name="food" data-uuid="${esc(t.actorUuid)}" value="${t.food}" title="Food a day"> / <input type="number" min="0" step="0.1" name="water" data-uuid="${esc(t.actorUuid)}" value="${t.water}" title="Water a day">`
      : t.food === t.water
        ? fmt(t.food)
        : `${fmt(t.food)} / ${fmt(t.water)}`;
    const wage = gm
      ? `<input type="number" min="0" step="1" name="wage" data-uuid="${esc(t.actorUuid)}" value="${t.wage}" title="Copper pieces a day"> cp`
      : t.wage
        ? cpText(t.wage)
        : `<span class="pf1hex-muted">—</span>`;
    const conditions = actor ? pf1Adapter.conditions(actor) : ["Missing actor"];
    const status = conditions.length ? `<span class="pf1hex-warn">${esc(conditions.join(", "))}</span>` : `<span class="pf1hex-muted">Fine</span>`;
    const remove = mine
      ? `<button type="button" class="pf1hex-icon" data-action="removeActor" data-uuid="${esc(t.actorUuid)}" title="Remove from the caravan"><i class="fa-solid fa-xmark"></i></button>`
      : "";
    return `<tr class="${mine && !gm ? "mine" : ""}">
  <td>${chip(t.actorUuid, t.name)} <a class="pf1hex-open" data-action="openActor" data-uuid="${esc(t.actorUuid)}" title="Open sheet"><i class="fa-solid fa-up-right-from-square"></i></a></td>
  <td>${esc(playerNames(actor))}</td><td>${travels}</td><td>${rolesCell}</td><td class="num">${eats}</td><td class="num">${wage}</td><td>${status}</td><td>${remove}</td></tr>`;
  });
  const travellers = `<section><h3 class="pf1hex-label">TRAVELLERS</h3>
<table class="pf1hex-table pf1hex-travellers"><thead><tr><th>Name</th><th>Player</th><th>Travels in</th><th>Roles</th><th class="num">Eats / day</th><th class="num">Wage</th><th>Status</th><th></th></tr></thead>
<tbody>${rows.join("") || `<tr><td colspan="8" class="pf1hex-drop">Drop characters, NPCs and animals here.</td></tr>`}</tbody></table></section>`;

  // --- roles ---
  const roleRows = ROLE_IDS.map((id) => roleRow(c, id)).join("");
  const warnings: string[] = [];
  for (const t of c.travellers) {
    const n = rolesOf(c, t.actorUuid).length;
    if (n > 2) warnings.push(`${t.name} holds ${n} roles; the limit is two.`);
  }
  const roles = `<section class="pf1hex-roles"><h3 class="pf1hex-label">ROLES</h3><div class="pf1hex-role-grid">${roleRows}</div>
${warnings.map((w) => `<div class="pf1hex-callout">${esc(w)}</div>`).join("")}
<p class="pf1hex-note">Roles are sticky. Holding two (driving counts) means −${store.getSettings().doublingPenalty} on both rolls.</p></section>`;

  // --- vehicles ---
  const cards = c.vehicles.map((v) => vehicleCard(c, v, infos.find((i) => i.actorUuid === v.actorUuid)!)).join("");
  const vehicles = `<section><h3 class="pf1hex-label">VEHICLES</h3><div class="pf1hex-vehicles">${cards}
<div class="pf1hex-drop pf1hex-vehicle-drop">Drop a pf1 vehicle actor here to add a wagon or cart.</div></div></section>`;

  // --- supplies ---
  const supplies = suppliesSection(c, gm);

  return `${gmBar}${header}<div class="pf1hex-tiles">${tiles}</div>${fundsForm}${travellers}${roles}${vehicles}${supplies}`;
}

function coinSummary(actor: any): string {
  const coins = pf1Adapter.coins(actor);
  return (["pp", "gp", "sp", "cp"] as const).map((k) => `${coins[k]} ${k}`).join(", ");
}

function roleRow(c: CaravanState, id: RoleId): string {
  const def = ROLE_DEFS[id];
  const holder = c.roles[id] ?? null;
  const holderActor = actorFor(holder);
  const editable = !holder || canControl(holderActor);
  const options = c.travellers
    .map((t) => {
      const actor = actorFor(t.actorUuid);
      if (!actor) return "";
      const skill = pf1Adapter.bestSkill(actor, def.skills);
      const mod = pf1Adapter.skillMod(actor, skill);
      const may = canControl(actor);
      return `<option value="${esc(t.actorUuid)}"${t.actorUuid === holder ? " selected" : ""}${may ? "" : " disabled"}>${esc(t.name)} · ${esc(
        pf1Adapter.skillLabel(skill),
      )} ${signed(mod)}</option>`;
    })
    .join("");
  const skills = def.skills.map((s) => pf1Adapter.skillLabel(s)).join(", ");
  return `<label class="pf1hex-role"><span><strong>${esc(def.name)}</strong> <span class="pf1hex-muted">${esc(skills)}</span></span>
<select name="role" data-role="${id}"${editable ? "" : " disabled"}><option value="">— vacant —</option>${options}</select></label>`;
}

function vehicleCard(c: CaravanState, v: VehicleLink, info: ReturnType<typeof vehicleInfos>[number]): string {
  const gm = !!game.user?.isGM;
  const actor = actorFor(v.actorUuid);
  const riders = c.travellers.filter((t) => t.seat === v.actorUuid && t.actorUuid !== v.driver && !v.team.includes(t.actorUuid));
  const broken = info.maxHp > 0 && info.hp <= info.maxHp / 2;
  const wrecked = info.maxHp > 0 && info.hp <= 0;
  const warnings: string[] = [];
  if (!v.driver) warnings.push("No driver: it won't move.");
  if (info.teamStrength < info.teamRequired)
    warnings.push(`Team too weak: ${fmt(info.teamStrength)} of ${fmt(info.teamRequired)} Large-equivalent needed.`);
  if (info.cargo > info.cargoCapacity * 2) warnings.push("Over twice its cargo capacity: it can't move.");
  else if (info.cargo > info.cargoCapacity) warnings.push("Over cargo capacity: it moves at a heavy-load pace.");
  if (riders.length > v.seats) warnings.push(`${riders.length - v.seats} rider(s) beyond the seats count as cargo.`);
  if (wrecked) warnings.push("Wrecked: it can't move.");
  else if (broken) warnings.push("Broken: half pace.");

  const ownedPickable = c.travellers.filter((t) => canControl(actorFor(t.actorUuid)));
  const driverEditable = !v.driver || canControl(actorFor(v.driver));
  const driver = v.driver
    ? chip(v.driver, c.travellers.find((t) => t.actorUuid === v.driver)?.name ?? "?", "clearDriver", ` data-vehicle="${esc(v.actorUuid)}"`)
    : `<span class="pf1hex-empty">No driver · drop someone here</span>`;
  const driverPick =
    driverEditable && ownedPickable.length
      ? `<select name="driverPick" data-vehicle="${esc(v.actorUuid)}" aria-label="Driver of ${esc(v.name)}">${option("", v.driver ? "— change —" : "— assign —")}${ownedPickable
          .filter((t) => t.actorUuid !== v.driver)
          .map((t) => option(t.actorUuid, t.name))
          .join("")}</select>`
      : "";
  const team = v.team.map((uuid) => chip(uuid, c.travellers.find((t) => t.actorUuid === uuid)?.name ?? "?", "clearTeam", ` data-vehicle="${esc(v.actorUuid)}"`)).join("");
  const teamPick = ownedPickable.some((t) => !v.team.includes(t.actorUuid))
    ? `<select name="teamPick" data-vehicle="${esc(v.actorUuid)}" aria-label="Add to the team of ${esc(v.name)}">${option("", "+ add to team")}${ownedPickable
        .filter((t) => !v.team.includes(t.actorUuid))
        .map((t) => option(t.actorUuid, t.name))
        .join("")}</select>`
    : "";
  const ridersLine = riders.length ? `<div class="pf1hex-riders">Riding: ${riders.map((t) => esc(t.name)).join(", ")}</div>` : "";
  const settings = gm
    ? `<details class="pf1hex-vehicle-settings"><summary>Settings</summary><div class="pf1hex-row">
  <label>Seats <input type="number" min="0" step="1" name="v-seats" data-vehicle="${esc(v.actorUuid)}" value="${v.seats}"></label>
  <label>Cargo lb <input type="number" min="0" step="1" name="v-cargoCapacity" data-vehicle="${esc(v.actorUuid)}" value="${v.cargoCapacity}"></label>
  <label>Team (Large) <input type="number" min="0" step="0.25" name="v-teamRequired" data-vehicle="${esc(v.actorUuid)}" value="${v.teamRequired}"></label>
  <label>mi/day <input type="number" min="0" step="1" name="v-milesPerDay" data-vehicle="${esc(v.actorUuid)}" value="${v.milesPerDay}"></label>
</div></details>`
    : "";
  const remove = canControl(actor)
    ? `<button type="button" class="pf1hex-icon" data-action="removeActor" data-uuid="${esc(v.actorUuid)}" title="Remove from the caravan"><i class="fa-solid fa-xmark"></i></button>`
    : "";
  return `<div class="pf1hex-vehicle${warnings.length ? " warn" : ""}" data-drop="seat" data-vehicle="${esc(v.actorUuid)}">
  <div class="pf1hex-vehicle-head"><a data-action="openActor" data-uuid="${esc(v.actorUuid)}"><strong>${esc(actor?.name ?? v.name)}</strong></a><span class="pf1hex-muted">${fmt(v.milesPerDay)} mi/day</span>${remove}</div>
  <div class="pf1hex-vehicle-stats"><span>${Math.min(riders.length, v.seats)} / ${v.seats} seats</span><span>${fmt(info.cargo)} / ${fmt(info.cargoCapacity)} lb</span>
    <span class="${wrecked || broken ? "pf1hex-warn" : ""}">HP ${info.hp}/${info.maxHp}${wrecked ? " · Wrecked" : broken ? " · Broken" : ""}</span></div>
  ${ridersLine}
  <div class="pf1hex-zone" data-drop="driver" data-vehicle="${esc(v.actorUuid)}"><div class="pf1hex-zone-label">DRIVER</div>${driver}${driverPick}</div>
  <div class="pf1hex-zone" data-drop="team" data-vehicle="${esc(v.actorUuid)}"><div class="pf1hex-zone-label">PULLED BY</div>
    <div class="pf1hex-team${v.team.length ? "" : " empty"}">${team || `<span class="pf1hex-empty">Nothing pulling it · drop animals here</span>`}</div>${teamPick}</div>
  ${warnings.map((w) => `<div class="pf1hex-callout">${esc(w)}</div>`).join("")}
  ${settings}
</div>`;
}

function suppliesSection(c: CaravanState, gm: boolean): string {
  const supplies = store.supplyItems();
  const rows = supplies
    .map((s) => {
      const qty = Number(s.item.system?.quantity ?? 0);
      const vehicle = c.vehicles.find((v) => v.actorUuid === s.vehicleUuid)?.name ?? "";
      return `<tr><td>${esc(s.item.name)}${s.container ? ` <span class="pf1hex-muted">in ${esc(s.container.name)}</span>` : ""}</td><td>${esc(vehicle)}</td><td>${s.track}</td><td class="num">${qty}</td><td class="num">${fmt(
        qty * s.unitsPerQuantity,
      )}</td></tr>`;
    })
    .join("");
  const list = rows
    ? `<table class="pf1hex-table"><thead><tr><th>Item</th><th>Vehicle</th><th>Supply</th><th class="num">Qty</th><th class="num">Person-days</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="pf1hex-note">No supplies in the vehicles. ${gm ? "Flag items in a vehicle's inventory as rations or water below." : "Supplies are items in the vehicles' inventories."}</p>`;

  let editor = "";
  if (gm) {
    const items: string[] = [];
    for (const v of c.vehicles) {
      const actor = actorFor(v.actorUuid);
      for (const item of actor?.items ?? []) {
        if (item.system?.quantity === undefined && item.type !== "container") continue;
        const track = item.getFlag?.(MODULE_ID, SUPPLY_FLAG) ?? "";
        const units = item.getFlag?.(MODULE_ID, UNITS_FLAG) ?? 1;
        const ref = `data-vehicle="${esc(v.actorUuid)}" data-item-id="${esc(item.id)}"`;
        items.push(`<tr><td>${esc(item.name)}${item.type === "container" ? ` <span class="pf1hex-muted">(container)</span>` : ""}</td><td>${esc(v.name)}</td>
<td><select name="supplyFlag" ${ref}>${option("", "none", !track)}${option("rations", "rations", track === "rations")}${option("water", "water", track === "water")}${option("repair", "repair materials", track === "repair")}</select></td>
<td><input type="number" min="0" step="0.1" name="supplyUnits" ${ref} value="${units}"></td></tr>`);
      }
    }
    editor = items.length
      ? `<details class="pf1hex-hold-editor"><summary>Flag vehicle items as supplies (a flagged container counts everything inside)</summary>
<table class="pf1hex-table"><thead><tr><th>Item</th><th>Vehicle</th><th>Supply</th><th>Units / qty</th></tr></thead><tbody>${items.join("")}</tbody></table></details>`
      : "";
  }
  const repair = store.repairValue();
  const repairLine = `<p class="pf1hex-note">Repair Materials: ${cpText(repair)}${repair < 1000 ? " — a Rest-day repair needs 10 gp of them" : ""}.</p>`;
  return `<section><h3 class="pf1hex-label">SUPPLIES</h3>${list}${repairLine}${editor}</section>`;
}

// ---------- events ----------

function report(result: CaravanResult): void {
  if (!result.ok) toast(result.error, result.code === "duplicate" ? "info" : "warn");
}

/** Attach the sheet's change/drag/drop listeners to the app's root element (once per app). */
export function bindCaravanSheet(app: any, el: HTMLElement): void {
  el.addEventListener("change", (event) => {
    const t = event.target as HTMLInputElement;
    if (!t?.name || t.dataset.keep !== undefined) return;
    // A handled select is done once picked: drop focus so the store change can re-render the sheet.
    if (t.tagName === "SELECT" && t.name !== "caravanActor") t.blur();
    void attempt(() => onFieldChange(t));
  });
  el.addEventListener("focusout", () => {
    const state = stateOf(app);
    if (!state.pending) return;
    // Let the next element take focus first; render only once nothing in the sheet is being edited.
    setTimeout(() => {
      const active = document.activeElement;
      if (active && el.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return;
      state.pending = false;
      if (app.rendered) app.render();
    }, 0);
  });
  el.addEventListener("dragstart", (event) => {
    const source = (event.target as HTMLElement)?.closest?.("[data-chip]") as HTMLElement | null;
    if (!source || !event.dataTransfer) return;
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: CHIP_TYPE, uuid: source.dataset.chip }));
  });
  el.addEventListener("dragover", (event) => {
    event.preventDefault();
    el.querySelectorAll(".pf1hex-over").forEach((n) => n.classList.remove("pf1hex-over"));
    ((event.target as HTMLElement)?.closest?.("[data-drop]") as HTMLElement | null)?.classList.add("pf1hex-over");
  });
  el.addEventListener("drop", (event) => {
    el.querySelectorAll(".pf1hex-over").forEach((n) => n.classList.remove("pf1hex-over"));
    void onDrop(event);
  });
}

async function onFieldChange(t: HTMLInputElement): Promise<void> {
  const uuid = t.dataset.uuid ?? "";
  const vehicle = t.dataset.vehicle ?? "";
  switch (t.name) {
    case "seat":
      return report(await caravanService.setSeat(uuid, t.value || null));
    case "role":
      return report(await caravanService.setRole(t.dataset.role as RoleId, t.value || null));
    case "driverPick":
      if (t.value) report(await caravanService.setDriver(vehicle, t.value));
      return;
    case "teamPick":
      if (t.value) report(await caravanService.setTeam(vehicle, t.value, true));
      return;
    case "food":
    case "water":
    case "wage": {
      const value = Number(t.value);
      if (!Number.isFinite(value) || value < 0) return toast("Enter a number of at least 0.", "warn");
      return report(await caravanService.updateTraveller(uuid, { [t.name]: value }));
    }
    case "v-seats":
    case "v-cargoCapacity":
    case "v-teamRequired":
    case "v-milesPerDay": {
      const value = Number(t.value);
      if (!Number.isFinite(value) || value < 0) return toast("Enter a number of at least 0.", "warn");
      return report(await caravanService.updateVehicle(vehicle, { [t.name.slice(2)]: value }));
    }
    case "supplyFlag":
    case "supplyUnits": {
      if (!game.user?.isGM) return;
      const item = actorFor(vehicle)?.items?.get?.(t.dataset.itemId);
      if (!item) return;
      if (t.name === "supplyFlag") {
        const track = t.value as SupplyTrack | "repair" | "";
        if (track) await item.setFlag(MODULE_ID, SUPPLY_FLAG, track);
        else await item.unsetFlag(MODULE_ID, SUPPLY_FLAG);
      } else {
        const units = Number(t.value);
        await item.setFlag(MODULE_ID, UNITS_FLAG, Number.isFinite(units) && units > 0 ? units : 1);
      }
      store.notify();
      return;
    }
    case "caravanActor":
      return; // applied by the Set button
  }
}

async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  const data = dragData(event);
  if (!data?.uuid) return;
  if (data.type === CHIP_TYPE) {
    const zone = (event.target as HTMLElement)?.closest?.("[data-drop]") as HTMLElement | null;
    const vehicle = zone?.dataset.vehicle;
    if (!zone || !vehicle) return;
    await attempt(async () => {
      if (zone.dataset.drop === "driver") report(await caravanService.setDriver(vehicle, data.uuid));
      else if (zone.dataset.drop === "team") report(await caravanService.setTeam(vehicle, data.uuid, true));
      else if (zone.dataset.drop === "seat") report(await caravanService.setSeat(data.uuid, vehicle));
    });
    return;
  }
  if (data.type === "Actor") await attempt(async () => report(await caravanService.add(data.uuid)));
}

/** Drop handler kept for the canvas/actor sheet: an Actor dragged onto it joins the caravan. Returns true if handled. */
export async function dropActorOnRoster(event: DragEvent): Promise<boolean> {
  event.preventDefault();
  const data = dragData(event);
  if (data?.type !== "Actor" || !data.uuid) return false;
  await attempt(async () => report(await caravanService.add(data.uuid)));
  return true;
}

// ---------- actions (data-action; `this` is the app) ----------

export const SHEET_ACTIONS: Record<string, (this: any, event: Event, target: HTMLElement) => unknown> = {
  setActor(this: any) {
    return attempt(async () => {
      const uuid = (this.element.querySelector("select[name=caravanActor]") as HTMLSelectElement | null)?.value || null;
      await store.setCaravanActor(uuid);
    });
  },
  createCaravan() {
    return attempt(async () => {
      if (!game.user?.isGM) return;
      const actor = await CONFIG.Actor.documentClass.create({ name: "Caravan", type: CARAVAN_TYPE, img: "icons/environment/settlement/wagon.webp" });
      if (actor) await store.setCaravanActor(actor.uuid);
    });
  },
  placeToken() {
    return attempt(async () => {
      if (!game.user?.isGM) return;
      const actor = store.getCaravanActor();
      if (!actor) return toast("Set or create a caravan first.", "warn");
      const c = store.getCaravan();
      const [i, j] = (c.sceneId === canvas?.scene?.id && c.position ? c.position : "").split(",").map(Number);
      const point = Number.isFinite(i) && Number.isFinite(j) ? canvas.grid.getCenterPoint({ i, j }) : null;
      await placeCaravanToken(actor, point);
    });
  },
  openActor(_event: Event, target: HTMLElement) {
    actorFor(target.dataset.uuid)?.sheet?.render(true);
  },
  removeActor(_event: Event, target: HTMLElement) {
    return attempt(async () => report(await caravanService.remove(target.dataset.uuid ?? "")));
  },
  clearDriver(_event: Event, target: HTMLElement) {
    return attempt(async () => report(await caravanService.setDriver(target.dataset.vehicle ?? "", null)));
  },
  clearTeam(_event: Event, target: HTMLElement) {
    return attempt(async () => report(await caravanService.setTeam(target.dataset.vehicle ?? "", target.dataset.uuid ?? "", false)));
  },
  openFunds(this: any, _event: Event, target: HTMLElement) {
    const state = stateOf(this);
    state.funds = target.dataset.mode === "withdraw" ? "withdraw" : "deposit";
    state.kept = {};
    this.render();
  },
  closeFunds(this: any) {
    const state = stateOf(this);
    state.funds = null;
    state.kept = {};
    this.render();
  },
  confirmFunds(this: any) {
    const app = this;
    return attempt(async () => {
      const state = stateOf(app);
      const el: HTMLElement = app.element;
      const value = (name: string) => (el.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? "";
      const coins: Coins = { pp: 0, gp: 0, sp: 0, cp: 0 };
      for (const k of ["pp", "gp", "sp", "cp"] as const) {
        const n = Number(value(`funds-${k}`) || 0);
        if (!Number.isInteger(n) || n < 0) return toast("Coins must be whole numbers of at least 0.", "warn");
        coins[k] = n;
      }
      const actorUuid = value("funds-actor");
      if (!actorUuid) return toast("Pick a character.", "warn");
      const result = state.funds === "withdraw" ? await caravanService.withdraw(actorUuid, coins) : await caravanService.deposit(actorUuid, coins);
      if (!result.ok) return report(result);
      toast(state.funds === "withdraw" ? "Withdrawn from party funds." : "Deposited into party funds.");
      state.funds = null;
      state.kept = {};
      app.render();
    });
  },
};

/**
 * GM: put the caravan on the viewed scene at the hex under `point` (default: the view centre) through
 * hx.caravan.place. With no point and the caravan already on this scene, pans to it instead.
 */
export async function placeCaravanToken(actor: any, point: { x: number; y: number } | null): Promise<void> {
  const scene = canvas?.scene;
  if (!scene) return toast("View a scene first.", "warn");
  const existing = scene.tokens?.find((t: any) => t.actorId === actor.id);
  if (existing && !point) {
    await canvas.animatePan?.({ x: existing.x, y: existing.y });
    return toast("The caravan is already on this scene.");
  }
  const at = point ?? { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };
  const o = canvas.grid.getOffset(at);
  const result = await caravanService.place(`${o.i},${o.j}`, scene.id);
  if (result.ok) toast("Caravan placed on the map.");
  else toast(result.error, "warn");
}

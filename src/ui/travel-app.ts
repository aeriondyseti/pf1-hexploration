// The Travel / Muster window (DESIGN §4.5). Every user opens it; the GM sees the controls.
// Players' map and route data always come from store.partyView() (invariant 1).
import { MODULE_ID, routeLabel, type LegState, type MapData, type Request, type RoleDef, type SupplyTrack } from "../types";
import { store } from "../store";
import { engine, legRoleDc } from "../engine";
import { authority } from "../authority";
import { pendingProposal, sendPathProposal, settleProposal, travel } from "../travel";
import { pf1Adapter } from "../pf1";
import { hexCanvas } from "../canvas";
import { actorFor, attempt, canControl, esc, option, rerenderer, toast } from "./html";
import { canvasGridShape, renderMiniMap, visiblePath } from "./minimap";

let TravelApp: any = null;

export function travelAppClass(): any {
  if (TravelApp) return TravelApp;
  const { ApplicationV2 } = foundry.applications.api;

  TravelApp = class extends (ApplicationV2 as any) {
    selectedRouteId: string | null = null;
    unsubscribe: (() => void) | null = null;

    static DEFAULT_OPTIONS = {
      id: "pf1hex-travel",
      classes: ["pf1hex", "pf1hex-travel"],
      window: { title: "Caravan Travel", resizable: true, icon: "fa-solid fa-route" },
      position: { width: 640, height: 720 },
      actions: {
        pickRoute: onPickRoute,
        startLeg: onStartLeg,
        startPath: onStartPath,
        proposePath: onProposePath,
        approveProposal: () => attempt(() => settleProposal(true)),
        dismissProposal: () => attempt(() => settleProposal(false)),
        claim: onClaim,
        release: onRelease,
        rollRole: onRollRole,
        resolve: () => attempt(() => travel.resolveMuster()),
        cancel: onCancel,
        nextDay: () => attempt(() => travel.nextDay()),
        arrive: () => attempt(() => travel.arrive()),
        undo: () => attempt(() => travel.undo()),
        preserve: onPreserve,
        rollSave: onRollSave,
        openCaravan: () => game.modules?.get(MODULE_ID)?.api?.ui?.openCaravan(),
      },
    };

    async _renderHTML(): Promise<string> {
      return renderTravel(this);
    }

    _replaceHTML(result: string, content: HTMLElement): void {
      content.innerHTML = result;
      const select = content.querySelector<HTMLSelectElement>("select[name=routeId]");
      select?.addEventListener("change", () => {
        this.selectedRouteId = select.value || null;
        this.render();
      });
    }

    async _onFirstRender(...args: any[]): Promise<void> {
      await super._onFirstRender?.(...args);
      this.unsubscribe = store.onChange(rerenderer(this));
    }

    _onClose(...args: any[]): void {
      super._onClose?.(...args);
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  };
  return TravelApp;
}

// ---------- rendering ----------

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

function renderTravel(app: any): string {
  const gm = !!game.user?.isGM;
  const caravan = store.getCaravan();
  const leg = caravan.leg;
  const map: MapData = gm ? store.getMap() : store.partyView();
  const actor = store.getCaravanActor();
  const totals = store.supplyTotals();
  const use = engine.consumption(caravan.roster);

  if (app.selectedRouteId && !map.routes[app.selectedRouteId]) app.selectedRouteId = null;
  const mapHtml = renderMiniMap(map, {
    grid: canvasGridShape(),
    position: caravan.position && map.hexes[caravan.position] ? caravan.position : null,
    legPath: visiblePath(leg?.plan, map),
    selectedRouteId: leg && leg.status !== "arrived" ? leg.plan.routeId : app.selectedRouteId,
    routesClickable: gm && (!leg || leg.status === "arrived"),
  });

  const title = actor
    ? esc(actor.name)
    : gm
      ? `No caravan actor <button type="button" data-action="openCaravan">Set one in the Caravan window</button>`
      : "Caravan";
  const header = `<header class="pf1hex-tracks">
  <h2>${title}</h2>
  <ul>
    <li><span>Rations</span><b>${fmt(totals.rations)}</b></li>
    <li><span>Water</span><b>${fmt(totals.water)}</b></li>
    <li><span>Wagon</span><b>${caravan.wagon.condition}/${caravan.wagon.max}</b></li>
    <li><span>Journey day</span><b>${caravan.journeyDay}</b></li>
    <li><span>Per day</span><b>${fmt(use.food)} food · ${fmt(use.water)} water</b></li>
  </ul>
</header>`;

  let body: string;
  if (!leg || leg.status === "arrived") {
    body = (leg ? `<p class="pf1hex-note">Arrived.</p>` : "") + renderNoLeg(app, map, gm);
  } else if (leg.status === "muster") {
    body = renderMuster(leg, map, gm);
  } else {
    body = renderUnderway(leg, gm);
  }

  return `${header}<section class="pf1hex-map">${mapHtml}</section>${body}`;
}

function renderNoLeg(app: any, map: MapData, gm: boolean): string {
  const routes = Object.values(map.routes);
  if (!gm) {
    const known = routes.length
      ? `<h3>Known routes</h3><ul class="pf1hex-routes">${routes
          .map(
            (r) =>
              `<li><b>${esc(routeLabel(r))}</b> — ${r.days}d, ${esc(r.difficulty)}${r.bargain ? `<br><i>${esc(r.bargain)}</i>` : ""}</li>`,
          )
          .join("")}</ul>`
      : "";
    const propose = hexCanvas.getPlottedPath()
      ? `<button type="button" data-action="proposePath"><i class="fa-solid fa-draw-polygon"></i> Propose plotted path to the GM</button>`
      : "";
    return `<p class="pf1hex-note">No leg mustering.</p>${known}${propose}`;
  }
  const proposal = pendingProposal();
  const proposalHtml = proposal
    ? `<div class="pf1hex-row pf1hex-proposal">${esc(game.users.get(proposal.userId)?.name ?? "A player")} proposes an off-route path (${proposal.path.length} hexes)
  <button type="button" data-action="approveProposal"><i class="fa-solid fa-check"></i> Approve</button>
  <button type="button" data-action="dismissProposal"><i class="fa-solid fa-xmark"></i> Dismiss</button></div>`
    : "";
  const selected = app.selectedRouteId ? map.routes[app.selectedRouteId] : null;
  const opts = [
    option("", "— choose a route (or click one on the map) —"),
    ...routes.map((r) => option(r.id, `${routeLabel(r)} — ${r.days}d, ${r.difficulty}`, r.id === selected?.id)),
  ];
  const bargain = selected?.bargain ? `<blockquote class="pf1hex-bargain">${esc(selected.bargain)}</blockquote>` : "";
  return `<section class="pf1hex-start">
  <h3>Start a leg</h3>
  ${proposalHtml}
  <div class="pf1hex-row"><select name="routeId">${opts.join("")}</select>
  <button type="button" data-action="startLeg"${selected ? "" : " disabled"}><i class="fa-solid fa-flag"></i> Start leg</button></div>
  ${bargain}
  <button type="button" data-action="startPath"><i class="fa-solid fa-draw-polygon"></i> Start off-route leg from plotted path</button>
</section>`;
}

function memberName(uuid: string | null): string {
  if (!uuid) return "vacant";
  return actorFor(uuid)?.name ?? store.getCaravan().roster.find((m) => m.actorUuid === uuid)?.name ?? "?";
}

function roleDc(role: RoleDef, leg: LegState, map: MapData): number {
  try {
    const rules = engine.effectiveMap(map);
    return legRoleDc(role, leg.plan, rules.hexes, rules.regions, store.getCaravan().roster);
  } catch {
    return role.baseDc;
  }
}

function renderMuster(leg: LegState, map: MapData, gm: boolean): string {
  const caravan = store.getCaravan();
  const settings = store.getSettings();
  const route = leg.plan.routeId ? map.routes[leg.plan.routeId] : null;
  const candidates = caravan.roster.filter((m) => gm || actorFor(m.actorUuid)?.isOwner);

  const rows = store.getRoles().map((role) => {
    const holder = leg.assignments.find((a) => a.roleId === role.id);
    const owner = !!holder && canControl(actorFor(holder.actorUuid));
    const roll = holder ? leg.rolls.find((r) => r.roleId === role.id && r.actorUuid === holder.actorUuid) : undefined;
    const doubled = holder ? engine.rolesHeldBy(holder.actorUuid, leg.assignments).length >= 2 : false;
    const roleAttr = `data-role-id="${esc(role.id)}"`;

    const claim = candidates.length
      ? `<select name="claim-${esc(role.id)}">${candidates.map((m) => option(m.actorUuid, m.name)).join("")}</select>` +
        `<button type="button" data-action="claim" ${roleAttr}>Claim</button>`
      : "";
    const holderAttrs = holder ? `${roleAttr} data-actor-uuid="${esc(holder.actorUuid)}"` : "";
    const rollBtn = owner
      ? `<button type="button" data-action="rollRole" ${holderAttrs}><i class="fa-solid fa-dice-d20"></i> ${roll ? "Reroll" : "Roll"}</button>`
      : "";
    const release = owner ? `<button type="button" data-action="release" ${holderAttrs}>Release</button>` : "";
    const warn = doubled
      ? ` <span class="pf1hex-warn" title="Holds two or more roles: penalty on each roll">doubled −${settings.doublingPenalty}</span>`
      : "";

    return `<tr>
  <td><b>${esc(role.name)}</b></td>
  <td>${role.skills.map((s) => esc(pf1Adapter.skillLabel(s))).join(" / ")}</td>
  <td class="num">${roleDc(role, leg, map)}</td>
  <td>${holder ? esc(memberName(holder.actorUuid)) : "<i>vacant</i>"}${warn}</td>
  <td class="num">${roll ? `<b>${roll.total}</b>` : ""}</td>
  <td class="pf1hex-actions">${rollBtn}${release}${claim}</td>
</tr>`;
  });

  const gmControls = gm
    ? `<footer class="pf1hex-controls">
  <button type="button" data-action="resolve"><i class="fa-solid fa-check"></i> Resolve muster</button>
  <button type="button" data-action="cancel"><i class="fa-solid fa-xmark"></i> Cancel leg</button>
</footer>`
    : "";

  return `<section class="pf1hex-muster">
  <h3>Muster — ${route ? esc(routeLabel(route)) : "off-route"} · ${leg.plan.baseDays}d, ${esc(leg.plan.difficulty)}</h3>
  ${route?.bargain ? `<blockquote class="pf1hex-bargain">${esc(route.bargain)}</blockquote>` : ""}
  <table class="pf1hex-table">
    <thead><tr><th>Role</th><th>Skills</th><th>DC</th><th>Holder</th><th>Roll</th><th></th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>
  ${gmControls}
</section>`;
}

function renderUnderway(leg: LegState, gm: boolean): string {
  const outcome = leg.outcome;
  if (!outcome) return `<p class="pf1hex-note">Leg underway.</p>`;
  const roles = store.getRoles();
  const done = leg.dayIndex >= outcome.days.length;
  const today = outcome.days[leg.dayIndex];

  const roleList = outcome.roles
    .map((r) => {
      const name = roles.find((d) => d.id === r.roleId)?.name ?? r.roleId;
      const result = r.total === null ? "—" : `${r.total} vs DC ${r.dc}`;
      return `<li class="${r.success ? "success" : "failure"}"><b>${esc(name)}</b> (${esc(memberName(r.actorUuid))}): ${result} — ${
        r.success ? "success" : "failure"
      }${r.doubled ? " (doubled)" : ""}</li>`;
    })
    .join("");

  let todayHtml = "";
  if (today) {
    const chosen = leg.preserveChoices[today.day];
    const tracks: SupplyTrack[] = ["rations", "water"];
    const preserve = today.preserveChoice
      ? `<div class="pf1hex-row">Forager: keep today's ${tracks
          .map(
            (t) =>
              `<button type="button" data-action="preserve" data-day="${today.day}" data-track="${t}" class="${chosen === t ? "active" : ""}">${
                t === "rations" ? "Rations" : "Water"
              }</button>`,
          )
          .join("")}</div>`
      : "";
    // Day prompts are GM-only text (invariant 1).
    const prompts =
      gm && today.prompts.length ? `<ul class="pf1hex-prompts">${today.prompts.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "";
    const march =
      today.forcedMarchDc !== null ? ` · <span class="pf1hex-warn">forced march, Fort DC ${today.forcedMarchDc}</span>` : "";
    todayHtml = `<div class="pf1hex-today">
  <h4>Next: day ${today.day}</h4>
  <p>Drain: ${fmt(today.drain.rations)} rations · ${fmt(today.drain.water)} water · ${fmt(today.drain.wagon)} wagon${march}</p>
  ${preserve}${prompts}
</div>`;
  }

  const saves = leg.saves.filter((s) => s.total === null || s.day === leg.dayIndex);
  const saveList = saves.length
    ? `<h4>Saves</h4><ul class="pf1hex-saves">${saves
        .map((s) => {
          const btn =
            s.total === null && canControl(actorFor(s.actorUuid))
              ? ` <button type="button" data-action="rollSave" data-actor-uuid="${esc(s.actorUuid)}" data-day="${s.day}"><i class="fa-solid fa-dice-d20"></i> Roll Fort</button>`
              : "";
          const total = s.total === null ? "<i>owed</i>" : `<b>${s.total}</b>`;
          return `<li>${esc(memberName(s.actorUuid))} — day ${s.day}, DC ${s.dc}: ${total}${btn}</li>`;
        })
        .join("")}</ul>`
    : "";

  const arrivalPrompts =
    gm && outcome.arrivalPrompts.length
      ? `<h4>GM prompts</h4><ul class="pf1hex-prompts">${outcome.arrivalPrompts.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`
      : "";

  const step = done
    ? `<button type="button" data-action="arrive"><i class="fa-solid fa-flag-checkered"></i> Arrive</button>`
    : `<button type="button" data-action="nextDay"><i class="fa-solid fa-forward-step"></i> Next day</button>`;
  const gmControls = gm
    ? `<footer class="pf1hex-controls">${step}
  <button type="button" data-action="undo"><i class="fa-solid fa-rotate-left"></i> Undo</button>
  <button type="button" data-action="cancel"><i class="fa-solid fa-xmark"></i> Cancel leg</button>
</footer>`
    : "";

  const heading = done
    ? `All ${outcome.totalDays} days travelled`
    : `Day ${leg.dayIndex + 1} of ${outcome.totalDays}`;
  return `<section class="pf1hex-underway">
  <h3>${heading}${outcome.surprised ? ` <span class="pf1hex-warn">surprised</span>` : ""}</h3>
  <ul class="pf1hex-outcomes">${roleList}</ul>
  ${todayHtml}${saveList}${arrivalPrompts}${gmControls}
</section>`;
}

// ---------- actions (called as handler.call(app, event, target)) ----------

function onPickRoute(this: any, _event: Event, target: HTMLElement) {
  if (!game.user?.isGM) return;
  this.selectedRouteId = target.dataset.routeId ?? null;
  this.render();
}

function onStartLeg(this: any) {
  return attempt(async () => {
    const id = this.selectedRouteId ?? this.element.querySelector("select[name=routeId]")?.value;
    if (!id) return toast("Choose a route first.", "warn");
    await travel.startLeg(engine.planFromRoute(store.getMap(), id));
  });
}

function onStartPath() {
  return attempt(async () => {
    const plotted = hexCanvas.getPlottedPath();
    if (!plotted || !plotted.path.length) return toast("Plot a path with the painter's Path tool first.", "warn");
    await travel.startLeg(engine.planFromPath(store.getMap(), plotted.from, plotted.path));
  });
}

function onProposePath() {
  return attempt(async () => {
    const plotted = hexCanvas.getPlottedPath();
    if (!plotted) return toast("Plot a path first.", "warn");
    const result = await sendPathProposal(plotted.from, plotted.path);
    toast(result.ok ? "Path sent to the GM." : (result.error ?? "Request refused."), result.ok ? "info" : "warn");
  });
}

async function sendRequest(request: Request) {
  const result = await authority.send(request);
  if (!result.ok) toast(result.error ?? "Request refused.", "warn");
}

function onClaim(this: any, _event: Event, target: HTMLElement) {
  const roleId = target.dataset.roleId!;
  const select = this.element.querySelector(`select[name="claim-${CSS.escape(roleId)}"]`) as HTMLSelectElement | null;
  if (!select?.value) return;
  return attempt(() => sendRequest({ type: "claimRole", roleId, actorUuid: select.value }));
}

function onRelease(_event: Event, target: HTMLElement) {
  const { roleId, actorUuid } = target.dataset;
  return attempt(() => sendRequest({ type: "releaseRole", roleId: roleId!, actorUuid: actorUuid! }));
}

function onRollRole(_event: Event, target: HTMLElement) {
  return attempt(() => travel.rollRole(target.dataset.roleId!, target.dataset.actorUuid!));
}

function onRollSave(_event: Event, target: HTMLElement) {
  return attempt(() => travel.rollSave(target.dataset.actorUuid!, Number(target.dataset.day)));
}

function onPreserve(_event: Event, target: HTMLElement) {
  const track = target.dataset.track as SupplyTrack;
  return attempt(() => sendRequest({ type: "preserveChoice", day: Number(target.dataset.day), track }));
}

function onCancel() {
  return attempt(async () => {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Cancel leg" },
      content: "<p>Cancel the current leg?</p>",
    });
    if (ok) await travel.cancelLeg();
  });
}

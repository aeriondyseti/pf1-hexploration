// The Travel window (DESIGN §4.10, §4.13): the shared plan (activity + course), GM approval, and the
// day controls. Players see the party view only (invariant 1).
import { hexCanvas } from "../canvas";
import { undo } from "../ledger";
import { store } from "../store";
import { estimateDays, terrainLabel, travel } from "../travel";
import { authority } from "../authority";
import type { Activity, HexKey, Route } from "../types";
import { actorFor, attempt, esc, rerenderer, toast } from "./html";

const ACTIVITIES: { id: Activity; label: string; icon: string; text: string }[] = [
  { id: "travel", label: "Travel", icon: "fa-route", text: "Follow a course. Every role rolls each day." },
  {
    id: "explore",
    label: "Explore",
    icon: "fa-magnifying-glass",
    text: "Stay and search this hex (Ultimate Campaign exploration time). When done, the hex is Mapped and its secrets show.",
  },
  { id: "forage", label: "Forage", icon: "fa-wheat-awn", text: "Stay a day. A successful Forager keeps both rations and water undrained." },
  { id: "rest", label: "Rest", icon: "fa-campground", text: "Make camp a day. The Wainwright repairs (10 gp); the Healer gives long-term care." },
];

/** The course along a known route from the caravan's hex: towards whichever end is further away. */
export function courseAlong(route: Route, position: HexKey | null): HexKey[] {
  const chain = [route.from, ...route.hexes];
  const at = position ? chain.indexOf(position) : -1;
  if (at < 0) return [];
  const forward = chain.slice(at + 1);
  const backward = chain.slice(0, at).reverse();
  return forward.length >= backward.length ? forward : backward;
}

export function travelAppClass(): any {
  const { ApplicationV2 } = foundry.applications.api;

  return class TravelApp extends (ApplicationV2 as any) {
    static DEFAULT_OPTIONS = {
      id: "pf1hex-travel",
      classes: ["pf1hex", "pf1hex-travel"],
      window: { title: "Caravan Travel", icon: "fa-solid fa-route", resizable: true },
      position: { width: 380, height: "auto" },
      actions: {
        activity(this: any, _e: Event, t: HTMLElement) {
          const c = store.getCaravan();
          const activity = t.dataset.activity as Activity;
          void attempt(async () => {
            const res = await travel.setPlan(
              { activity, course: activity === "travel" ? c.plan.course : [], routeId: c.plan.routeId },
              `chose ${activity}`,
            );
            if (!res.ok) toast(res.error ?? "Refused", "warn");
          });
        },
        plot(this: any) {
          this.minimize?.();
          hexCanvas.plotCourse();
        },
        clearCourse() {
          void travel.setPlan({ activity: "travel", course: [], routeId: null }, "cleared the course");
        },
        approve: () => attempt(() => travel.approve()),
        nextDay: () => attempt(() => travel.nextDay()),
        travelAll: () => attempt(() => travel.travelAll()),
        stop: () => attempt(() => travel.stop()),
        undo: () => attempt(() => travel.undo()),
        askStop: () =>
          attempt(async () => {
            await authority.send({ type: "askStop" });
            toast("Asked the GM to stop the caravan.");
          }),
      },
    };

    #unsubscribe: (() => void) | null = null;

    async _renderHTML(): Promise<string> {
      const gm = !!game.user?.isGM;
      const c = store.getCaravan();
      const view = gm ? store.getMap(c.sceneId ?? undefined) : store.partyView(c.sceneId ?? undefined);
      const here = c.position ? view.hexes[c.position] : undefined;
      const region = here?.region ? view.regions[here.region]?.name : null;
      const where = c.position ? `${terrainLabel(here?.terrain)}${region ? `, ${esc(region)}` : ""}` : "Not on the map";
      const status = c.trip ? "On the road" : "Camped";
      const header = `<header class="pf1hex-travel-head"><strong>${status}</strong> · ${where} · Day ${c.journeyDay}</header>`;

      const preview = travel.preview();
      const checks = preview?.checks.length
        ? `<h3>Today's checks</h3><table class="pf1hex-checks"><tbody>${preview.checks
            .map((ch) => {
              const who = ch.actorUuid ? esc(actorFor(ch.actorUuid)?.name ?? "?") : "<em>vacant</em>";
              const dc = ch.auto ? "road: no check" : `DC ${ch.dc}${ch.penalty ? ` (−${ch.penalty})` : ""}${ch.bonus ? ` (+${ch.bonus})` : ""}`;
              return `<tr><td>${esc(ch.label)}</td><td>${who}</td><td>${dc}</td></tr>`;
            })
            .join("")}</tbody></table>`
        : "";
      const pace = preview?.pace
        ? `<p class="pf1hex-note">Pace ${preview.pace.milesPerDay} mi/day (${esc(preview.pace.setBy)})${
            preview.pace.blocked ? ` — <strong>can't move: ${esc(preview.pace.blocked)}</strong>` : ""
          }</p>`
        : "";
      const undoLabel = undo.available();
      const undoBtn = gm && undoLabel ? `<button type="button" data-action="undo"><i class="fa-solid fa-rotate-left"></i> Undo ${esc(undoLabel)}</button>` : "";

      if (c.trip) {
        const t = c.trip;
        const left = t.activity === "travel" ? `${t.course.length} hex${t.course.length === 1 ? "" : "es"} to go (≈${estimateDays(t.course)} days)` : "";
        const controls = gm
          ? `<div class="pf1hex-row">
              <button type="button" class="pf1hex-primary" data-action="nextDay"><i class="fa-solid fa-sun"></i> Next Day</button>
              ${t.activity === "travel" ? `<button type="button" data-action="travelAll"><i class="fa-solid fa-forward"></i> Travel all</button>` : ""}
              <button type="button" data-action="stop"><i class="fa-solid fa-hand"></i> Stop</button></div>
             <div class="pf1hex-row">${undoBtn}</div>`
          : `<button type="button" data-action="askStop"><i class="fa-solid fa-hand"></i> Ask to stop</button>`;
        return `<section class="pf1hex-travel-body">${header}
          <p><strong>${ACTIVITIES.find((a) => a.id === t.activity)?.label}</strong> · day ${t.day + 1} of the trip${left ? ` · ${left}` : ""}</p>
          ${pace}${checks}${controls}</section>`;
      }

      const plan = c.plan;
      const tabs = ACTIVITIES.map(
        (a) =>
          `<button type="button" class="pf1hex-tab${plan.activity === a.id ? " active" : ""}" data-action="activity" data-activity="${a.id}"><i class="fa-solid ${a.icon}"></i> ${a.label}</button>`,
      ).join("");
      const about = ACTIVITIES.find((a) => a.id === plan.activity)?.text ?? "";
      let course = "";
      if (plan.activity === "travel") {
        const routes = Object.values(view.routes).filter((r) => courseAlong(r, c.position).length);
        const routeSelect = routes.length
          ? `<select name="route"><option value="">Follow a known road…</option>${routes
              .map((r) => `<option value="${esc(r.id)}"${plan.routeId === r.id ? " selected" : ""}>${esc(r.name || "Unnamed road")} (${r.kind})</option>`)
              .join("")}</select>`
          : "";
        const n = plan.course.length;
        course = `<div class="pf1hex-course">
          <p>${n ? `<strong>${n} hex${n === 1 ? "" : "es"}</strong> · ≈${estimateDays(plan.course)} day${estimateDays(plan.course) === 1 ? "" : "s"}` : "No course yet."}</p>
          <div class="pf1hex-row"><button type="button" data-action="plot"><i class="fa-solid fa-pen"></i> ${n ? "Change course" : "Plot course"}</button>
          ${n ? `<button type="button" data-action="clearCourse">Clear</button>` : ""}</div>${routeSelect}</div>`;
      }
      const totals = store.supplyTotals();
      const use = c.travellers.reduce((s, t) => ({ food: s.food + t.food, water: s.water + t.water }), { food: 0, water: 0 });
      const days = (stock: number, perDay: number) => (perDay > 0 ? Math.floor(stock / perDay) : "∞");
      const supplies = `<p class="pf1hex-note">Food ${days(totals.rations, use.food)} days · Water ${days(totals.water, use.water)} days</p>`;
      const edit = plan.lastEdit ? `<p class="pf1hex-note">${esc(plan.lastEdit.user)} ${esc(plan.lastEdit.text)}.</p>` : "";
      const ready = plan.activity !== "travel" || plan.course.length > 0;
      const approve = gm
        ? `<button type="button" class="pf1hex-primary" data-action="approve" ${ready && c.position ? "" : "disabled"}><i class="fa-solid fa-check"></i> Approve & start</button>`
        : `<p class="pf1hex-note">The GM approves the plan to start.</p>`;
      return `<section class="pf1hex-travel-body">${header}
        <div class="pf1hex-tabs">${tabs}</div><p class="pf1hex-note">${esc(about)}</p>
        ${course}${supplies}${edit}${pace}${checks}
        <div class="pf1hex-row">${approve}${undoBtn}</div></section>`;
    }

    _replaceHTML(result: string, content: HTMLElement): void {
      content.innerHTML = result;
    }

    async _onFirstRender(context: any, options: any): Promise<void> {
      await super._onFirstRender?.(context, options);
      this.#unsubscribe = store.onChange(rerenderer(this));
      (this.element as HTMLElement).addEventListener("change", (e) => {
        const t = e.target as HTMLSelectElement;
        if (t.name !== "route") return;
        const route = t.value ? store.partyView(store.getCaravan().sceneId ?? undefined).routes[t.value] : null;
        const course = route ? courseAlong(route, store.getCaravan().position) : [];
        void attempt(async () => {
          const res = await travel.setPlan({ activity: "travel", course, routeId: route?.id ?? null }, route ? `chose ${route.name || "a road"}` : "cleared the road");
          if (!res.ok) toast(res.error ?? "Refused", "warn");
        });
      });
    }

    async _onClose(options: any): Promise<void> {
      this.#unsubscribe?.();
      this.#unsubscribe = null;
      await super._onClose?.(options);
    }
  };
}

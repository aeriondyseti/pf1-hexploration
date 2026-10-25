// The Caravan actor subtype (`pf1-hexploration.caravan`, DESIGN §4.6). pf1's actor proxy falls back to
// ActorBasePF for types it does not map, so the subtype runs on pf1's base actor class. Caravan state stays in
// JSON flags (src/store); the system model only carries notes. Call registerCaravanType() in init.
import { CARAVAN_TYPE, MODULE_ID } from "../types";
import { store } from "../store";
import { hexUi } from "../ui";
import { dragData, esc, toast } from "../ui/html";
import { dropActorOnRoster } from "../ui/caravan-app";

export function registerCaravanType(): void {
  const { TypeDataModel } = foundry.abstract;
  const fields = foundry.data.fields;

  class CaravanModel extends (TypeDataModel as any) {
    static defineSchema() {
      return { notes: new fields.HTMLField({ required: false, blank: true, initial: "" }) };
    }
  }
  CONFIG.Actor.dataModels[CARAVAN_TYPE] = CaravanModel;

  const sheets = foundry.applications?.apps?.DocumentSheetConfig ?? (globalThis as any).DocumentSheetConfig;
  sheets.registerSheet(Actor, MODULE_ID, caravanSheetClass(), { types: [CARAVAN_TYPE], makeDefault: true, label: "Caravan" });
}

function caravanSheetClass(): any {
  const { ActorSheetV2 } = foundry.applications.sheets;

  return class CaravanSheet extends (ActorSheetV2 as any) {
    static DEFAULT_OPTIONS = {
      classes: ["pf1hex", "pf1hex-caravan-sheet"],
      position: { width: 420, height: 460 },
      window: { resizable: true, icon: "fa-solid fa-horse" },
      actions: {
        openCaravan: () => hexUi.openCaravan(),
        makeActive(this: any) {
          return store.setCaravanActor(this.document.uuid);
        },
      },
    };

    async _renderHTML(): Promise<string> {
      const actor = this.document;
      const gm = !!game.user?.isGM;
      const active = store.getCaravanActor()?.uuid === actor.uuid;
      const items = (actor.items?.contents ?? [])
        .map((item: any) => {
          const inside = item.type === "container" ? ` (${item.items?.size ?? 0} inside)` : "";
          const supply = item.getFlag?.(MODULE_ID, "supply");
          return `<li>${esc(item.name)} × ${Number(item.system?.quantity ?? 0)}${esc(inside)}${supply ? ` — <em>${esc(supply)}</em>` : ""}</li>`;
        })
        .join("");
      return `<section class="pf1hex-caravan-sheet-body">
<header class="pf1hex-row"><img src="${esc(actor.img)}" width="48" height="48" alt=""><h2>${esc(actor.name)}</h2></header>
<p>${active ? "This is the active caravan." : "Not the active caravan."}
${gm && !active ? `<button type="button" data-action="makeActive">Make active</button>` : ""}</p>
<button type="button" data-action="openCaravan"><i class="fa-solid fa-route"></i> Open Caravan window</button>
<h3>Hold</h3>
<ul class="pf1hex-hold">${items || "<li><em>Empty — drop items here.</em></li>"}</ul>
<p class="pf1hex-note">Drop pf1 items or containers onto this sheet to load the hold, or actors to add them to the roster. Flag supplies (or a whole crate) in the Caravan window.</p>
</section>`;
    }

    _replaceHTML(result: string, content: HTMLElement): void {
      content.innerHTML = result;
    }

    _onRender(context: any, options: any): void {
      super._onRender?.(context, options);
      const el: HTMLElement = this.element;
      el.addEventListener("dragover", (event) => event.preventDefault());
      el.addEventListener("drop", (event) => this.dropItem(event));
    }

    async dropItem(event: DragEvent): Promise<void> {
      event.preventDefault();
      if (!game.user?.isGM) return; // invariant 2: the hold and roster are GM-written
      const data = dragData(event);
      if (data?.type === "Actor") {
        if (store.getCaravanActor()?.uuid !== this.document.uuid) {
          toast("Make this the active caravan before adding to its roster.", "warn");
          return;
        }
        await dropActorOnRoster(event);
        return;
      }
      if (data?.type !== "Item" || !data.uuid) return;
      const item = await fromUuid(data.uuid);
      if (!item || item.parent?.uuid === this.document.uuid) return;
      await this.document.createEmbeddedDocuments("Item", [item.toObject()]);
    }
  };
}

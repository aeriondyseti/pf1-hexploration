// The Caravan actor subtype (`pf1-hexploration.caravan`, DESIGN §4.4). pf1's actor proxy falls back to
// ActorBasePF for types it does not map, so the subtype runs on pf1's base actor class. Caravan state stays in
// JSON flags (src/store); the system model only carries notes. Its sheet is the Caravan sheet (src/ui/caravan-app),
// the same render as the Caravan window. Call registerCaravanType() in init.
import { CARAVAN_TOKEN, CARAVAN_TYPE, MODULE_ID } from "../types";
import { store } from "../store";
import { attempt, esc } from "../ui/html";
import {
  SHEET_ACTIONS,
  bindCaravanSheet,
  newSheetState,
  placeCaravanToken,
  renderCaravanSheet,
  restoreKept,
  sheetRerenderer,
} from "../ui/caravan-app";

export function registerCaravanType(): void {
  const { TypeDataModel } = foundry.abstract;
  const fields = foundry.data.fields;

  class CaravanModel extends (TypeDataModel as any) {
    static defineSchema() {
      return { notes: new fields.HTMLField({ required: false, blank: true, initial: "" }) };
    }
  }
  CONFIG.Actor.dataModels[CARAVAN_TYPE] = CaravanModel;

  // Dropping a caravan on the canvas: place its linked token ourselves (hex-centred) instead of Foundry's default.
  Hooks.on("dropCanvasData", (_canvas: any, data: any) => {
    if (data?.type !== "Actor" || !data.uuid) return;
    const actor = fromUuidSync(data.uuid);
    if (actor?.type !== CARAVAN_TYPE || !game.user?.isGM) return;
    void attempt(() => placeCaravanToken(actor, Number.isFinite(data.x) ? { x: data.x, y: data.y } : null));
    return false;
  });

  // One caravan, one linked token, no resource bars (pf1 token bars expect HP the caravan doesn't have).
  Hooks.on("preCreateActor", (actor: any, data: any) => {
    if (data?.type !== CARAVAN_TYPE) return;
    actor.updateSource({ prototypeToken: { ...CARAVAN_TOKEN, ...(data.prototypeToken ?? {}) } });
  });

  const sheets = foundry.applications?.apps?.DocumentSheetConfig ?? (globalThis as any).DocumentSheetConfig;
  sheets.registerSheet(Actor, MODULE_ID, caravanSheetClass(), { types: [CARAVAN_TYPE], makeDefault: true, label: "Caravan" });
}

function caravanSheetClass(): any {
  const { ActorSheetV2 } = foundry.applications.sheets;

  return class CaravanSheet extends (ActorSheetV2 as any) {
    sheetState = newSheetState();
    unsubscribe: (() => void) | null = null;

    static DEFAULT_OPTIONS = {
      classes: ["pf1hex", "pf1hex-caravan", "pf1hex-caravan-sheet"],
      position: { width: 980, height: 760 },
      window: { resizable: true, icon: "fa-solid fa-horse" },
      actions: {
        ...SHEET_ACTIONS,
        makeActive(this: any) {
          return attempt(() => store.setCaravanActor(this.document.uuid));
        },
      },
    };

    async _renderHTML(): Promise<string> {
      const actor = this.document;
      if (store.getCaravanActor()?.uuid !== actor.uuid) {
        const gm = !!game.user?.isGM;
        return `<section class="pf1hex-sheet-inactive"><header class="pf1hex-sheet-head"><img class="pf1hex-sheet-img" src="${esc(actor.img)}" alt="">
<div class="pf1hex-sheet-name">${esc(actor.name)}</div></header>
<p>This is not the active caravan.</p>${gm ? `<button type="button" data-action="makeActive">Make this the active caravan</button>` : ""}</section>`;
      }
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

    // The sheet handles its own drops (actors join the caravan, name chips go to driver/team zones).
    _onDrop(): void {}
  };
}

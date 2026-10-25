// UI layer: the Travel/Muster window and the Caravan window (ApplicationV2, HTML strings).
import type { UiApi } from "../contracts";
import { travelAppClass } from "./travel-app";
import { caravanAppClass } from "./caravan-app";

const instances = new Map<string, any>();

function open(key: string, cls: () => any): void {
  let app = instances.get(key);
  if (!app) {
    app = new (cls())();
    instances.set(key, app);
  }
  app.render({ force: true });
}

export const hexUi = {
  register() {
    // Scene-control buttons for both windows are added by hexCanvas.register (CanvasApi owns the controls group).
  },
  openTravel() {
    open("travel", travelAppClass);
  },
  openCaravan() {
    open("caravan", caravanAppClass);
  },
} satisfies UiApi;

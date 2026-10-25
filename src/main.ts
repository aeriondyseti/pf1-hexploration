import { MODULE_ID } from "./types";
import { store } from "./store";
import { authority } from "./authority";
import { ledger } from "./ledger";
import { pf1Adapter } from "./pf1";
import { travel } from "./travel";
import { hexCanvas } from "./canvas";
import { hexUi } from "./ui";
import { engine } from "./engine";
import { registerCaravanType } from "./model";
import { caravan } from "./caravan";

Hooks.once("init", () => {
  store.registerSettings();
  registerCaravanType();
  hexCanvas.register();
  hexUi.register();
});

Hooks.once("ready", () => {
  authority.init();
  travel.init();
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { store, authority, ledger, pf1: pf1Adapter, travel, caravan, canvas: hexCanvas, ui: hexUi, engine };
});

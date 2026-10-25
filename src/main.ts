import { MODULE_ID } from "./types";
import { store } from "./store";
import { authority } from "./authority";
import { ledger } from "./ledger";
import { pf1Adapter } from "./pf1";
import { travel } from "./travel";
import { hexCanvas } from "./canvas";
import { hexUi } from "./ui";
import { engine } from "./engine";

Hooks.once("init", () => {
  store.registerSettings();
  hexCanvas.register();
  hexUi.register();
});

Hooks.once("ready", () => {
  authority.init();
  travel.init();
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { store, authority, ledger, pf1: pf1Adapter, travel, canvas: hexCanvas, ui: hexUi, engine };
});

// Canvas layer: hex terrain rendering, the GM painter and the scene-control buttons.
import type { CanvasApi } from "../contracts";
import { store } from "../store";
import { hexUi } from "../ui";
import { drawLayer, teardownLayer } from "./layer";
import { closePainter, getPlottedPath, openPainter } from "./painter";
import { attachTooltip, detachTooltip, registerTooltipSetting } from "./tooltip";
import { getView, onViewChange, registerViewSetting, setView } from "./view";
import { openViewPanel } from "./view-panel";

// Shared terrain palette (the UI mini-map uses it too).
export { TERRAINS, terrainFill } from "./terrain";

// Coalesce bursts of store notifications into one redraw per frame.
let redrawQueued = false;
function scheduleRedraw(): void {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    drawLayer();
  });
}

export const hexCanvas = {
  register() {
    registerTooltipSetting();
    registerViewSetting();
    onViewChange(scheduleRedraw);
    Hooks.on("canvasReady", () => {
      drawLayer();
      attachTooltip();
      // Our tools only make sense on hex scenes; rebuild the controls so they appear/disappear per scene.
      (globalThis as any).ui?.controls?.render?.({ reset: true });
    });
    Hooks.on("canvasTearDown", () => {
      detachTooltip();
      closePainter();
      teardownLayer();
    });
    // The store may not be usable until ready.
    Hooks.once("ready", () => {
      store.onChange(scheduleRedraw);
    });
    Hooks.on("getSceneControlButtons", (controls: any) => {
      const tools = controls?.tokens?.tools;
      if (!tools) return;
      const hex = !!canvas?.grid?.isHexagonal;
      tools["pf1hex-painter"] = {
        name: "pf1hex-painter",
        title: "Hex Painter",
        icon: "fa-solid fa-paintbrush",
        order: 100,
        button: true,
        visible: hex && !!game.user?.isGM,
        onChange: () => openPainter(),
      };
      tools["pf1hex-travel"] = {
        name: "pf1hex-travel",
        title: "Caravan Travel",
        icon: "fa-solid fa-route",
        order: 101,
        button: true,
        visible: hex,
        onChange: () => hexUi.openTravel(),
      };
      tools["pf1hex-view"] = {
        name: "pf1hex-view",
        title: "Hex View",
        icon: "fa-solid fa-eye",
        order: 103,
        button: true,
        visible: hex,
        onChange: () => openViewPanel(),
      };
      tools["pf1hex-caravan"] = {
        name: "pf1hex-caravan",
        title: "Caravan",
        icon: "fa-solid fa-horse",
        order: 102,
        button: true,
        visible: hex,
        onChange: () => hexUi.openCaravan(),
      };
    });
  },
  openPainter,
  redraw: drawLayer,
  getPlottedPath,
  getView,
  setView,
  openViewPanel,
} satisfies CanvasApi;

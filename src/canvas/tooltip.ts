// Hover tooltip: a small panel near the cursor with the hovered hex's key info. GMs see the full map; players
// see only store.partyView() (invariant 1). Per-user toggle: the "hexTooltips" client setting.
import { store } from "../store";
import { MODULE_ID, type HexKey } from "../types";
import { hexInfo } from "./helpers";
import { terrainLabel } from "./terrain";

const DELAY_MS = 250;

let el: HTMLDivElement | null = null;
let lastKey: HexKey | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let attached = false;

export function registerTooltipSetting(): void {
  game.settings.register(MODULE_ID, "hexTooltips", {
    name: "Hex tooltips",
    hint: "Show a small panel with a hex's terrain, region, landmarks and routes when you hover over it.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
}

function enabled(): boolean {
  try {
    return !!game.settings.get(MODULE_ID, "hexTooltips");
  } catch {
    return true;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function hide(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  lastKey = null;
  if (el) el.style.display = "none";
}

function place(clientX: number, clientY: number): void {
  if (!el || el.style.display === "none") return;
  const pad = 16;
  const { innerWidth: w, innerHeight: h } = window;
  const rect = el.getBoundingClientRect();
  const x = clientX + pad + rect.width > w ? clientX - pad - rect.width : clientX + pad;
  const y = clientY + pad + rect.height > h ? clientY - pad - rect.height : clientY + pad;
  el.style.left = `${Math.max(0, x)}px`;
  el.style.top = `${Math.max(0, y)}px`;
}

function show(key: HexKey, clientX: number, clientY: number): void {
  const gm = !!game.user?.isGM;
  const map = gm ? store.getMap() : store.partyView();
  const caravan = store.getCaravan();
  const info = hexInfo(map, key, {
    gm,
    knowledge: gm ? (store.getPartyMap().knowledge[key] ?? "unknown") : undefined,
    caravanHere: caravan.sceneId === canvas.scene?.id && caravan.position === key,
    terrainLabel,
    tableName: (uuid) => {
      try {
        return (fromUuidSync(uuid) as any)?.name ?? uuid;
      } catch {
        return uuid;
      }
    },
  });
  if (!info) return hide();
  el ??= Object.assign(document.body.appendChild(document.createElement("div")), { className: "pf1hex-tooltip" });
  el.innerHTML = `<strong>${escapeHtml(info.title)}</strong>${info.lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}`;
  el.style.display = "block";
  place(clientX, clientY);
}

/**
 * Is the canvas itself under the cursor? PIXI tracks pointer moves across the whole page, so without this the
 * tooltip would show through character sheets and other windows.
 */
function overCanvas(clientX: number, clientY: number): boolean {
  const board = canvas?.app?.view ?? document.getElementById("board");
  const under = document.elementFromPoint?.(clientX, clientY);
  return !!board && under === board;
}

let pointer = { x: 0, y: 0 };

function onMove(event: any): void {
  const clientX = event.clientX ?? event.client?.x ?? 0;
  const clientY = event.clientY ?? event.client?.y ?? 0;
  pointer = { x: clientX, y: clientY };
  if (!enabled() || !canvas?.grid?.isHexagonal || !overCanvas(clientX, clientY)) return hide();
  const pos = event.getLocalPosition(canvas.stage);
  const o = canvas.grid.getOffset({ x: pos.x, y: pos.y });
  const key = `${o.i},${o.j}`;
  if (key === lastKey) return place(clientX, clientY);
  hide();
  lastKey = key;
  timer = setTimeout(() => {
    // The cursor may have moved onto a window during the delay.
    if (overCanvas(pointer.x, pointer.y)) show(key, pointer.x, pointer.y);
  }, DELAY_MS);
}

export function attachTooltip(): void {
  if (attached || !canvas?.stage) return;
  canvas.stage.on("pointermove", onMove);
  canvas.app?.view?.addEventListener?.("pointerleave", hide);
  attached = true;
}

export function detachTooltip(): void {
  if (attached) {
    canvas?.stage?.off?.("pointermove", onMove);
    canvas?.app?.view?.removeEventListener?.("pointerleave", hide);
  }
  attached = false;
  hide();
}

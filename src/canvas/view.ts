// Per-user view options for the hex layer: which elements to draw. Stored in a client setting (each user and
// browser keeps their own); the layer redraws whenever they change. Hover tooltips keep their own setting.
import { MODULE_ID } from "../types";

export interface ViewOptions {
  terrain: boolean; // terrain fills
  borders: boolean; // hex and region borders
  difficulty: boolean; // E/S/H/B letters
  tags: boolean; // tag glyphs
  routes: boolean; // route lines
  routeNames: boolean; // route labels
  hiddenRoutes: boolean; // GM only: routes the party doesn't know (drawn faint)
  landmarks: boolean; // landmark stars
  landmarkNames: boolean; // landmark labels
  leg: boolean; // the current leg's path
}

export const DEFAULT_VIEW: ViewOptions = {
  terrain: true,
  borders: true,
  difficulty: true,
  tags: true,
  routes: true,
  routeNames: true,
  hiddenRoutes: true,
  landmarks: true,
  landmarkNames: true,
  leg: true,
};

/** Panel rows, in display order. `gmOnly` rows are hidden from players. */
export const VIEW_ROWS: { key: keyof ViewOptions; label: string; gmOnly?: boolean }[] = [
  { key: "terrain", label: "Terrain fill" },
  { key: "borders", label: "Hex & region borders" },
  { key: "difficulty", label: "Difficulty letters" },
  { key: "tags", label: "Tag glyphs" },
  { key: "routes", label: "Routes" },
  { key: "routeNames", label: "Route names" },
  { key: "hiddenRoutes", label: "Hidden routes", gmOnly: true },
  { key: "landmarks", label: "Landmarks" },
  { key: "landmarkNames", label: "Landmark names" },
  { key: "leg", label: "Current leg path" },
];

const SETTING = "viewOptions";
const listeners = new Set<() => void>();

export function registerViewSetting(): void {
  game.settings.register(MODULE_ID, SETTING, {
    scope: "client",
    config: false,
    type: String,
    default: "",
    onChange: () => listeners.forEach((fn) => fn()),
  });
}

/** Merge saved options over the defaults (unknown or missing keys fall back to "on"). */
export function parseView(raw: unknown): ViewOptions {
  let saved: Partial<Record<keyof ViewOptions, unknown>> = {};
  try {
    saved = typeof raw === "string" && raw ? JSON.parse(raw) : {};
  } catch {
    saved = {};
  }
  const view = { ...DEFAULT_VIEW };
  for (const key of Object.keys(DEFAULT_VIEW) as (keyof ViewOptions)[]) {
    if (typeof saved[key] === "boolean") view[key] = saved[key] as boolean;
  }
  return view;
}

export function getView(): ViewOptions {
  try {
    return parseView(game.settings.get(MODULE_ID, SETTING));
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

export async function setView(patch: Partial<ViewOptions>): Promise<ViewOptions> {
  const next = { ...getView(), ...patch };
  await game.settings.set(MODULE_ID, SETTING, JSON.stringify(next));
  return next;
}

export function onViewChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

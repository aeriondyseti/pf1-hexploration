// GM map painter: an ApplicationV2 window plus canvas pointer handling for its tools.
// Brush strokes are previewed on a working copy and written once on pointerup (one store write per stroke).
import { store } from "../store";
import type { Difficulty, HexDefaults, HexKey, KnowledgeState, Landmark, MapData, MapRules, Region, Route } from "../types";
import { DIFFICULTIES, ENCOUNTER_BONUS, MODULE_ID, UC_TAGS, routeLabel } from "../types";
import {
  joinColor,
  splitColor,
  applyBrush,
  hexDefaultsFor,
  restampUnregioned,
  escapeHtml,
  extendPath,
  formatDcMods,
  hexKey,
  parseDcMods,
  parseEffects,
  parseHexKey,
  parsePrompts,
  type BrushOp, DEFAULT_BASE_COLOR } from "./helpers";
import { drawLayer } from "./layer";
import { draft, notify } from "./state";
import { TERRAINS, TERRAIN_KEYS } from "./terrain";

type Tool = "terrain" | "region" | "tags" | "erase" | "landmark" | "route" | "path" | "knowledge";
const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: "terrain", label: "Terrain", icon: "fa-paintbrush" },
  { id: "region", label: "Region", icon: "fa-draw-polygon" },
  { id: "tags", label: "Tags", icon: "fa-tags" },
  { id: "erase", label: "Erase", icon: "fa-eraser" },
  { id: "landmark", label: "Landmark", icon: "fa-star" },
  { id: "route", label: "Route", icon: "fa-route" },
  { id: "path", label: "Path", icon: "fa-shoe-prints" },
  { id: "knowledge", label: "Knowledge", icon: "fa-eye" },
];
const BRUSHES = new Set<Tool>(["terrain", "region", "tags", "erase", "knowledge"]);
const KNOWLEDGE: KnowledgeState[] = ["unknown", "explored", "mapped"];

/** Every named input in the painter writes here on change, so values survive re-renders. */
const f: Record<string, string | boolean> = {
  tool: "terrain",
  terrain: "plains",
  difficulty: "easy",
  regionId: "",
  tag: "difficult",
  customTag: "",
  knowledge: "explored",
  pathFromCaravan: true,
};
/** Which edit form is open: a region id ("" = new), a landmark draft, or the route form. */
let regionEdit: string | null = null;
let landmarkEdit: { id: string | null; hex: HexKey } | null = null;
let routeFormOpen = false;

let app: any = null;
let stroking = false;
let strokeOp: BrushOp | null = null;

const str = (k: string) => String(f[k] ?? "");
const randomId = (): string => foundry.utils.randomID();
const cloneMap = (): MapData => structuredClone(store.getMap());

// ---------- canvas pointer handling ----------

function keyAt(event: any): HexKey | null {
  const pos = event.getLocalPosition(canvas.stage);
  const o = canvas.grid.getOffset({ x: pos.x, y: pos.y });
  if (o.i < 0 || o.j < 0) return null;
  return hexKey(o);
}

function adjacent(a: HexKey, b: HexKey): boolean {
  return canvas.grid.getAdjacentOffsets(parseHexKey(a)).some((o: any) => hexKey(o) === b);
}

function brushOp(tool: Tool, first: HexKey, map: MapData): BrushOp | null {
  switch (tool) {
    case "terrain":
      return {
        kind: "terrain",
        terrain: str("terrain"),
        difficulty: str("difficulty") as Difficulty,
        encounterMod: str("encMod").trim() === "" ? null : Number(str("encMod")) || 0,
      };
    case "region":
      return { kind: "region", regionId: str("regionId") || null };
    case "tags": {
      const tag = str("customTag").trim() || str("tag");
      return { kind: "tag", tag, add: !map.hexes[first]?.tags.includes(tag) };
    }
    case "erase":
      return { kind: "erase" };
    default:
      return null;
  }
}

function paint(key: HexKey): void {
  if (draft.stroke.includes(key)) return;
  draft.stroke.push(key);
  if (draft.working && strokeOp) {
    const working = draft.working;
    const fallback: HexDefaults = { terrain: str("terrain"), difficulty: str("difficulty") as Difficulty, tags: [], encounterMod: 0 };
    draft.working = applyBrush(working, [key], strokeOp, (regionId) => hexDefaultsFor(working, regionId, fallback));
  }
  drawLayer();
}

function onPointerDown(event: any): void {
  if (event.button !== 0 || !canvas.grid?.isHexagonal) return;
  const key = keyAt(event);
  if (!key) return;
  const tool = str("tool") as Tool;
  if (BRUSHES.has(tool)) {
    stroking = true;
    draft.stroke = [];
    draft.working = tool === "knowledge" ? null : cloneMap();
    strokeOp = draft.working ? brushOp(tool, key, draft.working) : null;
    paint(key);
  } else if (tool === "landmark") {
    clickLandmark(key);
  } else if (tool === "route") {
    clickRoute(key);
  } else if (tool === "path") {
    clickPath(key);
  }
}

function onPointerMove(event: any): void {
  if (!stroking) return;
  const key = keyAt(event);
  if (key) paint(key);
}

async function onPointerUp(): Promise<void> {
  if (!stroking) return;
  stroking = false;
  const keys = draft.stroke;
  const working = draft.working;
  try {
    if (str("tool") === "knowledge") {
      await store.setKnowledge(canvas.scene.id, keys, str("knowledge") as KnowledgeState);
    } else if (working) {
      await store.setMap(working);
    }
  } catch (err) {
    notify("error", `PF1 Hexploration: ${(err as Error).message}`);
  } finally {
    draft.working = null;
    draft.stroke = [];
    strokeOp = null;
    drawLayer();
  }
}

function clickLandmark(key: HexKey): void {
  const existing = Object.values(store.getMap().landmarks).find((l) => l.hex === key);
  openLandmark(existing ?? null, key);
}

function openLandmark(lm: Landmark | null, hex: HexKey): void {
  landmarkEdit = { id: lm?.id ?? null, hex };
  f["lm.name"] = lm?.name ?? "";
  f["lm.description"] = lm?.description ?? "";
  f["lm.known"] = lm?.knownToParty ?? false;
  app?.render();
}

function clickRoute(key: HexKey): void {
  const r = (draft.route ??= { id: null, from: null, hexes: [] });
  if (!r.from) {
    r.from = key;
  } else {
    const next = extendPath(r.from, r.hexes, key, adjacent);
    if (next.error) notify("warn", next.error);
    r.hexes = next.path;
  }
  drawLayer();
  app?.render();
}

function clickPath(key: HexKey): void {
  const p = draft.plotted;
  if (!p.from) {
    const caravanPos = f.pathFromCaravan ? store.getCaravan().position : null;
    p.from = caravanPos ?? key;
    p.path = [];
    if (!caravanPos) {
      drawLayer();
      app?.render();
      return;
    }
  }
  const next = extendPath(p.from, p.path, key, adjacent);
  if (next.error) notify("warn", next.error);
  p.path = next.path;
  drawLayer();
  app?.render();
}

function attachPointer(): void {
  canvas.stage.on("pointerdown", onPointerDown);
  canvas.stage.on("pointermove", onPointerMove);
  canvas.stage.on("pointerup", onPointerUp);
  canvas.stage.on("pointerupoutside", onPointerUp);
}

function detachPointer(): void {
  canvas.stage?.off("pointerdown", onPointerDown);
  canvas.stage?.off("pointermove", onPointerMove);
  canvas.stage?.off("pointerup", onPointerUp);
  canvas.stage?.off("pointerupoutside", onPointerUp);
  stroking = false;
  draft.working = null;
  draft.stroke = [];
}

// ---------- form saving ----------

const ROUTE_DEFAULT_COLOR = "#7a3b10";
/** The route form's colour, omitted when it is the default opaque brown. */
function routeColor(): { color?: string } {
  const color = colorFromForm("rt.color", ROUTE_DEFAULT_COLOR);
  return color === ROUTE_DEFAULT_COLOR ? {} : { color };
}

const tagList = (text: string) => text.split(",").map((t) => t.trim()).filter(Boolean);

/** Read a defaults block (`<prefix>Terrain`, `Difficulty`, `Tags`, `Mod`); no terrain chosen = no defaults. */
function defaultsFromForm(prefix: string): HexDefaults | undefined {
  const terrain = str(`${prefix}Terrain`);
  if (!terrain) return undefined;
  return {
    terrain,
    difficulty: (str(`${prefix}Difficulty`) || "standard") as Difficulty,
    tags: tagList(str(`${prefix}Tags`)),
    encounterMod: Number(str(`${prefix}Mod`)) || 0,
  };
}

function defaultsIntoForm(prefix: string, d: HexDefaults | undefined): void {
  f[`${prefix}Terrain`] = d?.terrain ?? "";
  f[`${prefix}Difficulty`] = d?.difficulty ?? "standard";
  f[`${prefix}Tags`] = (d?.tags ?? []).join(", ");
  f[`${prefix}Mod`] = d?.encounterMod ? String(d.encounterMod) : "";
}

/** Load the viewed scene's map defaults and rules into the painter form. */
function mapFormFromScene(): void {
  const map = store.getMap();
  defaultsIntoForm("md.d", map.defaults);
  f["md.table"] = map.rules?.encounterTable ?? "";
  f["md.dcMods"] = formatDcMods(map.rules?.dcMods ?? {});
  f["md.water"] = String(map.rules?.waterMultiplier ?? 1);
  f["md.storm"] = map.rules?.stormThreshold == null ? "" : String(map.rules.stormThreshold);
  colorIntoForm("mapColor", map.baseColor, DEFAULT_BASE_COLOR);
}

async function saveMapDefaults(): Promise<void> {
  let dcMods: Record<string, number>;
  try {
    dcMods = parseDcMods(str("md.dcMods"));
  } catch (err) {
    return notify("error", (err as Error).message);
  }
  const storm = str("md.storm").trim();
  const rules: MapRules = {
    dcMods,
    encounterTable: str("md.table").trim() || null,
    waterMultiplier: Number(str("md.water")) || 1,
    stormThreshold: storm === "" || Number.isNaN(Number(storm)) ? null : Number(storm),
  };
  const map = cloneMap();
  map.rules = rules;
  const defaults = defaultsFromForm("md.d");
  if (defaults) map.defaults = defaults;
  else delete map.defaults;
  await store.setMap(map);
  notify("info", "Map defaults saved.");
}

async function restampMap(): Promise<void> {
  const current = store.getMap();
  if (!current.defaults) return notify("warn", "Set and save the map's default terrain first.");
  const dialog = foundry.applications?.api?.DialogV2;
  const ok = dialog
    ? await dialog.confirm({
        window: { title: "Re-stamp region-less hexes" },
        content: "<p>Reset terrain, difficulty, tags and encounter mod of every hex outside a region to the map defaults?</p>",
      })
    : true;
  if (!ok) return;
  const { map, count } = restampUnregioned(current);
  await store.setMap(map);
  notify("info", `Re-stamped ${count} hex${count === 1 ? "" : "es"}.`);
}

async function saveRegion(): Promise<void> {
  const name = str("rg.name").trim();
  if (!name) return notify("warn", "A region needs a name.");
  let dcMods: Record<string, number>;
  try {
    dcMods = parseDcMods(str("rg.dcMods"));
  } catch (err) {
    return notify("error", (err as Error).message);
  }
  const storm = str("rg.storm").trim();
  const region: Region = {
    id: regionEdit || randomId(),
    name,
    color: colorFromForm("rg.color", "#cc3333"),
    encounterTable: str("rg.table").trim() || null,
    dcMods,
    waterMultiplier: Number(str("rg.water")) || 1,
    stormThreshold: storm === "" || Number.isNaN(Number(storm)) ? null : Number(storm),
  };
  const defaults = defaultsFromForm("rg.d");
  if (defaults) region.defaults = defaults;
  const map = cloneMap();
  map.regions[region.id] = region;
  await store.setMap(map);
  f.regionId = region.id;
  regionEdit = null;
}

async function deleteRegion(id: string): Promise<void> {
  const map = cloneMap();
  delete map.regions[id];
  for (const hex of Object.values(map.hexes)) if (hex.region === id) hex.region = null;
  await store.setMap(map);
  if (f.regionId === id) f.regionId = "";
  if (regionEdit === id) regionEdit = null;
}

async function saveLandmark(): Promise<void> {
  if (!landmarkEdit) return;
  const name = str("lm.name").trim();
  if (!name) return notify("warn", "A landmark needs a name.");
  const lm: Landmark = {
    id: landmarkEdit.id ?? randomId(),
    name,
    hex: landmarkEdit.hex,
    description: str("lm.description"),
    knownToParty: !!f["lm.known"],
  };
  const map = cloneMap();
  map.landmarks[lm.id] = lm;
  await store.setMap(map);
  landmarkEdit = null;
}

function openRouteForm(route: Route | null): void {
  routeFormOpen = true;
  const hexCount = draft.route?.hexes.length ?? 0;
  const difficulty = route?.difficulty ?? "standard";
  f["rt.name"] = route?.name ?? "";
  f["rt.days"] = String(route?.days ?? hexCount);
  f["rt.difficulty"] = difficulty;
  f["rt.bonus"] = String(route?.encounterBonus ?? ENCOUNTER_BONUS[difficulty]);
  f["rt.bargain"] = route?.bargain ?? "";
  colorIntoForm("rt.color", route?.color, ROUTE_DEFAULT_COLOR);
  f["rt.known"] = route?.knownToParty ?? false;
  f["rt.effects"] = JSON.stringify(route?.effects ?? [], null, 1);
  f["rt.prompts"] = JSON.stringify(route?.prompts ?? [], null, 1);
}

async function saveRoute(): Promise<void> {
  const r = draft.route;
  if (!r?.from || !r.hexes.length) return notify("warn", "Click a start hex and at least one more hex first.");
  const name = str("rt.name").trim(); // optional: an unnamed route draws no label on the map
  let effects, prompts;
  try {
    effects = parseEffects(str("rt.effects"));
    prompts = parsePrompts(str("rt.prompts"));
  } catch (err) {
    return notify("error", (err as Error).message);
  }
  const difficulty = str("rt.difficulty") as Difficulty;
  const bonus = str("rt.bonus").trim();
  const route: Route = {
    id: r.id ?? randomId(),
    name,
    from: r.from,
    hexes: [...r.hexes],
    days: Math.max(1, Number(str("rt.days")) || r.hexes.length),
    difficulty,
    encounterBonus: bonus === "" || Number.isNaN(Number(bonus)) ? ENCOUNTER_BONUS[difficulty] : Number(bonus),
    bargain: str("rt.bargain"),
    ...routeColor(),
    effects,
    prompts,
    knownToParty: !!f["rt.known"],
  };
  const map = cloneMap();
  map.routes[route.id] = route;
  await store.setMap(map);
  draft.route = null;
  routeFormOpen = false;
}

// ---------- rendering ----------

const opt = (value: string, label: string, selected: string) =>
  `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
const input = (name: string, label: string, type = "text") =>
  `<label>${label} <input type="${type}" name="${name}" value="${escapeHtml(str(name))}"></label>`;
const checkbox = (name: string, label: string) =>
  `<label class="pf1hex-check"><input type="checkbox" name="${name}"${f[name] ? " checked" : ""}> ${label}</label>`;
const textarea = (name: string, label: string, rows = 3) =>
  `<label>${label}<textarea name="${name}" rows="${rows}">${escapeHtml(str(name))}</textarea></label>`;
const terrainSelect = (name: string, none: string) =>
  `<label>Terrain <select name="${name}">${opt("", none, str(name))}${TERRAIN_KEYS.map((k) => opt(k, TERRAINS[k].label, str(name))).join("")}</select></label>`;
/** A colour picker plus an opacity slider, stored in the form as `<name>.hex` / `<name>.alpha` (0–100). */
const colorField = (name: string, label: string) =>
  `<label class="pf1hex-color">${label} <input type="color" name="${name}.hex" value="${escapeHtml(str(`${name}.hex`) || "#888888")}">
    <input type="range" name="${name}.alpha" min="0" max="100" step="5" value="${escapeHtml(str(`${name}.alpha`) || "100")}"
      title="Opacity"><span class="hint">${escapeHtml(str(`${name}.alpha`) || "100")}%</span></label>`;
/** Load a stored colour into a colour field. */
function colorIntoForm(name: string, color: string | null | undefined, fallback: string): void {
  const { hex, alpha } = splitColor(color || fallback, fallback);
  f[`${name}.hex`] = hex;
  f[`${name}.alpha`] = String(Math.round(alpha * 100));
}
/** Read a colour field back as "#rrggbb" or "#rrggbbaa". */
const colorFromForm = (name: string, fallback: string) =>
  joinColor(str(`${name}.hex`) || fallback, str(`${name}.alpha`) === "" ? 1 : Number(str(`${name}.alpha`)) / 100);
const difficultySelect = (name: string) =>
  `<select name="${name}">${DIFFICULTIES.map((d) => opt(d, d, str(name))).join("")}</select>`;

function toolPanel(map: MapData): string {
  const tool = str("tool") as Tool;
  const regions = Object.values(map.regions);
  switch (tool) {
    case "terrain":
      return `<label>Terrain <select name="terrain">${TERRAIN_KEYS.map((k) => opt(k, TERRAINS[k].label, str("terrain"))).join("")}</select></label>
        <label>Difficulty ${difficultySelect("difficulty")}</label>
        ${input("encMod", "Encounter mod (blank = keep)", "number")}
        <p class="hint">Drag on the map to paint. New hexes start from their region's or the map's defaults.</p>`;
    case "region": {
      const list = regions
        .map(
          (r) => `<li><span class="swatch" style="background:${escapeHtml(r.color)}"></span>${escapeHtml(r.name)}
            <button type="button" data-action="editRegion" data-id="${r.id}"><i class="fa-solid fa-pen"></i></button>
            <button type="button" data-action="deleteRegion" data-id="${r.id}"><i class="fa-solid fa-trash"></i></button></li>`,
        )
        .join("");
      const form =
        regionEdit === null
          ? `<button type="button" data-action="newRegion"><i class="fa-solid fa-plus"></i> New region</button>`
          : `<fieldset><legend>${regionEdit ? "Edit" : "New"} region</legend>
              ${input("rg.name", "Name")}${colorField("rg.color", "Colour")}
              ${input("rg.table", "Encounter RollTable UUID")}
              ${input("rg.dcMods", "DC mods (role:mod, * = all)")}
              ${input("rg.water", "Water multiplier", "number")}${input("rg.storm", "Storm threshold", "number")}
              <fieldset><legend>Defaults for new hexes</legend>
                ${terrainSelect("rg.dTerrain", "(use map defaults)")}
                <label>Difficulty ${difficultySelect("rg.dDifficulty")}</label>
                ${input("rg.dTags", "Tags (comma-separated)")}${input("rg.dMod", "Encounter mod", "number")}
              </fieldset>
              <div class="buttons"><button type="button" data-action="saveRegion">Save</button>
              <button type="button" data-action="cancelForm">Cancel</button></div></fieldset>`;
      return `<label>Brush region <select name="regionId">${opt("", "(none — clears region)", str("regionId"))}${regions
        .map((r) => opt(r.id, r.name, str("regionId")))
        .join("")}</select></label>
        <ul class="pf1hex-list">${list}</ul>${form}`;
    }
    case "tags":
      return `<label>Tag <select name="tag">${UC_TAGS.map((t) => opt(t, t, str("tag"))).join("")}</select></label>
        ${input("customTag", "Custom tag (overrides)")}
        <p class="hint">Drag to toggle: the first hex decides add or remove.</p>`;
    case "erase":
      return `<p class="hint">Drag to erase hex records (terrain, region, tags).</p>`;
    case "knowledge":
      return `<label>Party knowledge <select name="knowledge">${KNOWLEDGE.map((k) => opt(k, k, str("knowledge"))).join("")}</select></label>
        <p class="hint">Drag to set what the party knows.</p>`;
    case "landmark": {
      if (!landmarkEdit) return `<p class="hint">Click a hex to add or edit its landmark.</p>`;
      return `<fieldset><legend>Landmark at ${landmarkEdit.hex}</legend>
        ${input("lm.name", "Name")}${textarea("lm.description", "Description")}${checkbox("lm.known", "Known to party")}
        <div class="buttons"><button type="button" data-action="saveLandmark">Save</button>
        <button type="button" data-action="cancelForm">Cancel</button></div></fieldset>`;
    }
    case "route": {
      const r = draft.route;
      const status = r?.from
        ? `Start ${r.from}, ${r.hexes.length} hex(es). Click the last hex again to remove it.`
        : "Click the start hex, then each adjacent hex in order.";
      const form = routeFormOpen
        ? `<fieldset><legend>${r?.id ? "Edit" : "New"} route</legend>
            ${input("rt.name", "Name (optional)")}${input("rt.days", "Days", "number")}
            ${colorField("rt.color", "Line colour")}
            <label>Difficulty ${difficultySelect("rt.difficulty")}</label>
            ${input("rt.bonus", "Encounter bonus (blank = by difficulty)", "number")}
            ${textarea("rt.bargain", "Bargain (player-facing)", 2)}${checkbox("rt.known", "Known to party")}
            ${textarea("rt.effects", "Effects (JSON array)", 4)}${textarea("rt.prompts", "GM prompts (JSON array)", 4)}
            <div class="buttons"><button type="button" data-action="saveRoute">Save route</button>
            <button type="button" data-action="cancelForm">Cancel</button></div></fieldset>`
        : `<button type="button" data-action="finishRoute"${r?.hexes.length ? "" : " disabled"}>Details…</button>`;
      return `<p class="hint">${status}</p>
        <div class="buttons"><button type="button" data-action="clearRoute">Clear</button></div>${form}`;
    }
    case "path": {
      const p = draft.plotted;
      return `${checkbox("pathFromCaravan", "Start from the caravan's position")}
        <p class="hint">${p.from ? `From ${p.from}, ${p.path.length} hex(es).` : "Click hexes to plot an off-route path."}</p>
        <div class="buttons"><button type="button" data-action="clearPath">Clear path</button></div>`;
    }
  }
}

function listsHtml(map: MapData): string {
  const landmarks = Object.values(map.landmarks)
    .map(
      (l) => `<li>${escapeHtml(l.name)} <span class="hint">${l.hex}${l.knownToParty ? "" : " · hidden"}</span>
        <button type="button" data-action="editLandmark" data-id="${l.id}"><i class="fa-solid fa-pen"></i></button>
        <button type="button" data-action="deleteLandmark" data-id="${l.id}"><i class="fa-solid fa-trash"></i></button></li>`,
    )
    .join("");
  const routes = Object.values(map.routes)
    .map(
      (r) => `<li>${escapeHtml(routeLabel(r))} <span class="hint">${r.hexes.length} hexes · ${r.difficulty}${r.knownToParty ? "" : " · hidden"}</span>
        <button type="button" data-action="editRoute" data-id="${r.id}"><i class="fa-solid fa-pen"></i></button>
        <button type="button" data-action="deleteRoute" data-id="${r.id}"><i class="fa-solid fa-trash"></i></button></li>`,
    )
    .join("");
  return `<details open><summary>Landmarks</summary><ul class="pf1hex-list">${landmarks || "<li class='hint'>None</li>"}</ul></details>
    <details open><summary>Routes</summary><ul class="pf1hex-list">${routes || "<li class='hint'>None</li>"}</ul></details>`;
}

function renderPainter(): string {
  if (!canvas?.grid?.isHexagonal) return `<p class="hint">This scene needs a hexagonal grid.</p>`;
  const map = store.getMap();
  const tool = str("tool");
  const tools = TOOLS.map(
    (t) => `<button type="button" class="${t.id === tool ? "active" : ""}" data-action="tool" data-tool="${t.id}" title="${t.label}">
      <i class="fa-solid ${t.icon}"></i> ${t.label}</button>`,
  ).join("");
  const mapRow = `<div class="pf1hex-row" title="Border colour for hexes that are not in a region">
    ${colorField("mapColor", "Map border")}
    <button type="button" data-action="saveMapColor">Set</button></div>`;
  const mapDefaults = `<details class="pf1hex-map-defaults"><summary>Map defaults &amp; rules (hexes outside any region)</summary>
    <fieldset><legend>New hexes start as</legend>
      ${terrainSelect("md.dTerrain", "(current terrain brush)")}
      <label>Difficulty ${difficultySelect("md.dDifficulty")}</label>
      ${input("md.dTags", "Tags (comma-separated)")}${input("md.dMod", "Encounter mod", "number")}
    </fieldset>
    <fieldset><legend>Travel rules</legend>
      ${input("md.table", "Encounter RollTable UUID")}${input("md.dcMods", "DC mods (role:mod, * = all)")}
      ${input("md.water", "Water multiplier", "number")}${input("md.storm", "Storm threshold", "number")}
    </fieldset>
    <div class="buttons"><button type="button" data-action="saveMapDefaults">Save</button>
      <button type="button" data-action="restampMap" title="Reset terrain, difficulty, tags and encounter mod of every hex outside a region to the map defaults">Re-stamp region-less hexes</button></div>
  </details>`;
  return `${mapRow}${mapDefaults}<div class="pf1hex-tools">${tools}</div><div class="pf1hex-panel">${toolPanel(map)}</div>${listsHtml(map)}`;
}

// ---------- actions (called with this = app) ----------

async function guarded(fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch (err) {
    notify("error", `PF1 Hexploration: ${(err as Error).message}`);
  }
  drawLayer();
  app?.render();
}

const id = (target: HTMLElement) => target.dataset.id ?? "";

const actions: Record<string, (event: Event, target: HTMLElement) => Promise<void>> = {
  tool: (_e, t) =>
    guarded(() => {
      f.tool = t.dataset.tool ?? "terrain";
      regionEdit = null;
      landmarkEdit = null;
    }),
  newRegion: () =>
    guarded(() => {
      regionEdit = "";
      Object.assign(f, { "rg.name": "", "rg.table": "", "rg.dcMods": "", "rg.water": "1", "rg.storm": "" });
      colorIntoForm("rg.color", null, "#cc3333");
      defaultsIntoForm("rg.d", undefined);
    }),
  editRegion: (_e, t) =>
    guarded(() => {
      const r = store.getMap().regions[id(t)];
      if (!r) return;
      regionEdit = r.id;
      Object.assign(f, {
        "rg.name": r.name,
        "rg.table": r.encounterTable ?? "",
        "rg.dcMods": formatDcMods(r.dcMods),
        "rg.water": String(r.waterMultiplier),
        "rg.storm": r.stormThreshold === null ? "" : String(r.stormThreshold),
      });
      defaultsIntoForm("rg.d", r.defaults);
      colorIntoForm("rg.color", r.color, "#cc3333");
    }),
  saveRegion: () => guarded(saveRegion),
  saveMapDefaults: () => guarded(saveMapDefaults),
  restampMap: () => guarded(restampMap),
  saveMapColor: () =>
    guarded(async () => {
      const map = cloneMap();
      map.baseColor = colorFromForm("mapColor", DEFAULT_BASE_COLOR);
      await store.setMap(map);
    }),
  deleteRegion: (_e, t) => guarded(() => deleteRegion(id(t))),
  saveLandmark: () => guarded(saveLandmark),
  editLandmark: (_e, t) =>
    guarded(() => {
      const lm = store.getMap().landmarks[id(t)];
      if (!lm) return;
      f.tool = "landmark";
      openLandmark(lm, lm.hex);
    }),
  deleteLandmark: (_e, t) =>
    guarded(async () => {
      const map = cloneMap();
      delete map.landmarks[id(t)];
      await store.setMap(map);
      if (landmarkEdit?.id === id(t)) landmarkEdit = null;
    }),
  finishRoute: () =>
    guarded(() => openRouteForm(draft.route?.id ? store.getMap().routes[draft.route.id] ?? null : null)),
  saveRoute: () => guarded(saveRoute),
  clearRoute: () =>
    guarded(() => {
      draft.route = null;
      routeFormOpen = false;
    }),
  editRoute: (_e, t) =>
    guarded(() => {
      const route = store.getMap().routes[id(t)];
      if (!route) return;
      f.tool = "route";
      draft.route = { id: route.id, from: route.from, hexes: [...route.hexes] };
      openRouteForm(route);
    }),
  deleteRoute: (_e, t) =>
    guarded(async () => {
      const map = cloneMap();
      delete map.routes[id(t)];
      await store.setMap(map);
      if (draft.route?.id === id(t)) {
        draft.route = null;
        routeFormOpen = false;
      }
    }),
  clearPath: () =>
    guarded(() => {
      draft.plotted = { from: null, path: [] };
    }),
  cancelForm: () =>
    guarded(() => {
      regionEdit = null;
      landmarkEdit = null;
      routeFormOpen = false;
    }),
};

function onFieldChange(event: Event): void {
  const el = event.target as HTMLInputElement;
  if (!el?.name) return;
  f[el.name] = el.type === "checkbox" ? el.checked : el.value;
  if (el.type === "range") {
    const readout = el.parentElement?.querySelector(".hint");
    if (readout) readout.textContent = `${el.value}%`;
  }
  if (event.type !== "change") return;
  if (el.name === "terrain") {
    f.difficulty = TERRAINS[el.value]?.difficulty ?? f.difficulty;
    app?.render();
  } else if (el.name === "rt.difficulty") {
    f["rt.bonus"] = String(ENCOUNTER_BONUS[el.value as Difficulty] ?? 0);
    app?.render();
  }
}

let PainterClass: any = null;

function painterClass(): any {
  if (PainterClass) return PainterClass;
  const { ApplicationV2 } = foundry.applications.api;
  PainterClass = class HexPainter extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-painter`,
      classes: ["pf1hex-painter"],
      window: { title: "Hex Painter", icon: "fa-solid fa-paintbrush", resizable: true },
      position: { width: 360, height: 640 },
      actions,
    };

    async _renderHTML(): Promise<string> {
      return renderPainter();
    }

    _replaceHTML(result: string, content: HTMLElement): void {
      content.innerHTML = result;
    }

    async _onFirstRender(context: any, options: any): Promise<void> {
      await super._onFirstRender?.(context, options);
      this.element.addEventListener("change", onFieldChange);
      this.element.addEventListener("input", onFieldChange);
      attachPointer();
    }

    async _onClose(options: any): Promise<void> {
      detachPointer();
      draft.route = null;
      regionEdit = null;
      landmarkEdit = null;
      routeFormOpen = false;
      app = null;
      drawLayer();
      await super._onClose?.(options);
    }
  };
  return PainterClass;
}

export function openPainter(): void {
  if (!game.user?.isGM) return;
  mapFormFromScene();
  if (!app) {
    const Cls = painterClass();
    app = new Cls();
  }
  app.render({ force: true });
}

export function closePainter(): void {
  app?.close();
}

export function getPlottedPath(): { from: HexKey; path: HexKey[] } | null {
  const p = draft.plotted;
  return p.from && p.path.length ? { from: p.from, path: [...p.path] } : null;
}

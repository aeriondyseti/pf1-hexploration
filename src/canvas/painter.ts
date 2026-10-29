// GM map painter: an ApplicationV2 window plus canvas pointer handling for its tools.
// Brush strokes are previewed on a working copy and written once on pointerup (one store write per stroke).
import { store } from "../store";
import type { HexDefaults, HexKey, KnowledgeState, Landmark, MapData, Region, Route, RouteKind, Terrain, TravelRules, UcTag } from "../types";
import { MODULE_ID, UC_TAGS } from "../types";
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
  parseHexKey,
  routeLabel,
  type BrushOp, DEFAULT_BASE_COLOR } from "./helpers";
import { drawLayer } from "./layer";
import { draft, notify } from "./state";
import { DEFAULT_LANDMARK_ICON, landmarkIcon, normalizeIcon, tagIcon } from "./icons";
import { TERRAINS, TERRAIN_KEYS } from "./terrain";

type Tool = "terrain" | "region" | "tags" | "erase" | "landmark" | "route" | "knowledge";
const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: "terrain", label: "Terrain", icon: "fa-paintbrush" },
  { id: "region", label: "Region", icon: "fa-draw-polygon" },
  { id: "tags", label: "Tags", icon: "fa-tags" },
  { id: "erase", label: "Erase", icon: "fa-eraser" },
  { id: "landmark", label: "Landmark", icon: "fa-star" },
  { id: "route", label: "Route", icon: "fa-route" },
  { id: "knowledge", label: "Knowledge", icon: "fa-eye" },
];
const BRUSHES = new Set<Tool>(["terrain", "region", "tags", "erase", "knowledge"]);
const KNOWLEDGE: KnowledgeState[] = ["unknown", "explored", "mapped"];

/** Every named input in the painter writes here on change, so values survive re-renders. */
const f: Record<string, string | boolean> = {
  tool: "terrain",
  terrain: "plains",
  regionId: "",
  tag: "difficult",
  knowledge: "explored",
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
      return { kind: "terrain", terrain: str("terrain") as Terrain };
    case "region":
      return { kind: "region", regionId: str("regionId") || null };
    case "tags": {
      const tag = str("tag") as UcTag;
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
    const fallback: HexDefaults = { terrain: str("terrain") as Terrain, tags: [] };
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
  f["lm.icon"] = lm?.icon ?? "";
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

/** Read a defaults block (`<prefix>Terrain`, `<prefix>Tag.<tag>` checkboxes); no terrain chosen = no defaults. */
function defaultsFromForm(prefix: string): HexDefaults | undefined {
  const terrain = str(`${prefix}Terrain`) as Terrain;
  if (!terrain) return undefined;
  return { terrain, tags: UC_TAGS.filter((t) => !!f[`${prefix}Tag.${t}`]) };
}

function defaultsIntoForm(prefix: string, d: HexDefaults | undefined): void {
  f[`${prefix}Terrain`] = d?.terrain ?? "";
  for (const t of UC_TAGS) f[`${prefix}Tag.${t}`] = !!d?.tags.includes(t);
}

/** Read a rules block (`<prefix>.table`, `.dcMods`, `.rations`, `.water`). Throws on bad DC mods. */
function rulesFromForm(prefix: string): TravelRules {
  const mult = (k: string) => {
    const text = str(`${prefix}.${k}`).trim();
    const n = Number(text);
    return text !== "" && Number.isFinite(n) && n >= 0 ? n : 1;
  };
  return {
    encounterTable: str(`${prefix}.table`).trim() || null,
    dcMods: parseDcMods(str(`${prefix}.dcMods`)),
    rationsMultiplier: mult("rations"),
    waterMultiplier: mult("water"),
  };
}

function rulesIntoForm(prefix: string, r: Partial<TravelRules> | undefined): void {
  f[`${prefix}.table`] = r?.encounterTable ?? "";
  f[`${prefix}.dcMods`] = formatDcMods(r?.dcMods ?? {});
  f[`${prefix}.rations`] = String(r?.rationsMultiplier ?? 1);
  f[`${prefix}.water`] = String(r?.waterMultiplier ?? 1);
}

/** Load the viewed scene's map defaults and rules into the painter form. */
function mapFormFromScene(): void {
  const map = store.getMap();
  defaultsIntoForm("md.d", map.defaults);
  rulesIntoForm("md", map.rules);
  colorIntoForm("mapColor", map.baseColor, DEFAULT_BASE_COLOR);
}

async function saveMapDefaults(): Promise<void> {
  let rules: TravelRules;
  try {
    rules = rulesFromForm("md");
  } catch (err) {
    return notify("error", (err as Error).message);
  }
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
        content: "<p>Reset terrain and elements of every hex outside a region to the map defaults?</p>",
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
  let rules: TravelRules;
  try {
    rules = rulesFromForm("rg");
  } catch (err) {
    return notify("error", (err as Error).message);
  }
  const region: Region = {
    id: regionEdit || randomId(),
    name,
    color: colorFromForm("rg.color", "#cc3333"),
    ...rules,
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
  const iconText = str("lm.icon").trim();
  if (iconText) {
    const icon = normalizeIcon(iconText);
    if (!icon) return notify("warn", `"${iconText}" is not a Font Awesome icon name (try fa-tower-observation).`);
    lm.icon = icon;
  }
  const map = cloneMap();
  map.landmarks[lm.id] = lm;
  await store.setMap(map);
  landmarkEdit = null;
}

function openRouteForm(route: Route | null): void {
  routeFormOpen = true;
  f["rt.name"] = route?.name ?? "";
  f["rt.kind"] = route?.kind ?? "road";
  colorIntoForm("rt.color", route?.color, ROUTE_DEFAULT_COLOR);
  f["rt.known"] = route?.knownToParty ?? false;
}

async function saveRoute(): Promise<void> {
  const r = draft.route;
  if (!r?.from || !r.hexes.length) return notify("warn", "Click a start hex and at least one more hex first.");
  const name = str("rt.name").trim(); // optional: an unnamed route draws no label on the map
  const kind: RouteKind = str("rt.kind") === "highway" ? "highway" : "road";
  const route: Route = {
    id: r.id ?? randomId(),
    name,
    from: r.from,
    hexes: [...r.hexes],
    kind,
    ...routeColor(),
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
/** An icon-name field with a live preview; blank = `placeholder`. */
const iconInput = (name: string, label: string, placeholder: string) => {
  const shown = normalizeIcon(str(name)) ?? placeholder;
  return `<label class="pf1hex-icon">${label} <i class="fa-solid ${escapeHtml(shown)} pf1hex-icon-preview"></i>
    <input type="text" name="${name}" value="${escapeHtml(str(name))}" placeholder="${escapeHtml(placeholder)}"></label>`;
};

const tagName = (t: string) => t.replace(/-/g, " ");
/** Checkboxes for the six UC elements, stored as `<prefix>Tag.<tag>`. */
const tagChecks = (prefix: string) =>
  `<div class="pf1hex-tag-checks">${UC_TAGS.map((t) => checkbox(`${prefix}Tag.${t}`, `<i class="fa-solid ${tagIcon(t)}"></i> ${tagName(t)}`)).join("")}</div>`;
/** Rules fields for a region or the map. */
const rulesFields = (prefix: string) =>
  `${input(`${prefix}.table`, "Encounter RollTable UUID")}
   ${input(`${prefix}.dcMods`, "DC mods (e.g. *:+5, navigator:-2)")}
   ${input(`${prefix}.rations`, "Rations multiplier", "number")}${input(`${prefix}.water`, "Water multiplier", "number")}`;

function toolPanel(map: MapData): string {
  const tool = str("tool") as Tool;
  const regions = Object.values(map.regions);
  switch (tool) {
    case "terrain":
      return `<label>Terrain <select name="terrain">${TERRAIN_KEYS.map((k) => opt(k, TERRAINS[k].label, str("terrain"))).join("")}</select></label>
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
              ${rulesFields("rg")}
              <fieldset><legend>Defaults for new hexes</legend>
                ${terrainSelect("rg.dTerrain", "(use map defaults)")}
                ${tagChecks("rg.d")}
              </fieldset>
              <div class="buttons"><button type="button" data-action="saveRegion">Save</button>
              <button type="button" data-action="cancelForm">Cancel</button></div></fieldset>`;
      return `<label>Brush region <select name="regionId">${opt("", "(none — clears region)", str("regionId"))}${regions
        .map((r) => opt(r.id, r.name, str("regionId")))
        .join("")}</select></label>
        <ul class="pf1hex-list">${list}</ul>${form}`;
    }
    case "tags":
      return `<label>Element <select name="tag">${UC_TAGS.map((t) => opt(t, tagName(t), str("tag"))).join("")}</select></label>
        <p class="hint"><i class="fa-solid ${tagIcon(str("tag"))}"></i> Drag to toggle: the first hex decides add or remove.</p>`;
    case "erase":
      return `<p class="hint">Drag to erase hex records (terrain, region, elements).</p>`;
    case "knowledge":
      return `<label>Party knowledge <select name="knowledge">${KNOWLEDGE.map((k) => opt(k, k, str("knowledge"))).join("")}</select></label>
        <p class="hint">Drag to set what the party knows.</p>`;
    case "landmark": {
      if (!landmarkEdit) return `<p class="hint">Click a hex to add or edit its landmark.</p>`;
      return `<fieldset><legend>Landmark at ${landmarkEdit.hex}</legend>
        ${input("lm.name", "Name")}${iconInput("lm.icon", "Icon", DEFAULT_LANDMARK_ICON)}
        ${textarea("lm.description", "Description")}${checkbox("lm.known", "Known to party")}
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
            ${input("rt.name", "Name (optional)")}
            <label>Kind <select name="rt.kind">${opt("highway", "Highway", str("rt.kind"))}${opt("road", "Road / trail", str("rt.kind"))}</select></label>
            ${colorField("rt.color", "Line colour")}
            ${checkbox("rt.known", "Known to party")}
            <div class="buttons"><button type="button" data-action="saveRoute">Save route</button>
            <button type="button" data-action="cancelForm">Cancel</button></div></fieldset>`
        : `<button type="button" data-action="finishRoute"${r?.hexes.length ? "" : " disabled"}>Details…</button>`;
      return `<p class="hint">${status}</p>
        <div class="buttons"><button type="button" data-action="clearRoute">Clear</button></div>${form}`;
    }
  }
}

function listsHtml(map: MapData): string {
  const landmarks = Object.values(map.landmarks)
    .map(
      (l) => `<li><i class="fa-solid ${escapeHtml(landmarkIcon(l))} pf1hex-icon-preview"></i> ${escapeHtml(l.name)} <span class="hint">${l.hex}${l.knownToParty ? "" : " · hidden"}</span>
        <button type="button" data-action="editLandmark" data-id="${l.id}"><i class="fa-solid fa-pen"></i></button>
        <button type="button" data-action="deleteLandmark" data-id="${l.id}"><i class="fa-solid fa-trash"></i></button></li>`,
    )
    .join("");
  const routes = Object.values(map.routes)
    .map(
      (r) => `<li>${escapeHtml(routeLabel(r))} <span class="hint">${r.hexes.length} hexes · ${r.kind}${r.knownToParty ? "" : " · hidden"}</span>
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
      ${tagChecks("md.d")}
    </fieldset>
    <fieldset><legend>Travel rules</legend>
      ${rulesFields("md")}
    </fieldset>
    <div class="buttons"><button type="button" data-action="saveMapDefaults">Save</button>
      <button type="button" data-action="restampMap" title="Reset terrain and elements of every hex outside a region to the map defaults">Re-stamp region-less hexes</button></div>
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
      f["rg.name"] = "";
      rulesIntoForm("rg", undefined);
      colorIntoForm("rg.color", null, "#cc3333");
      defaultsIntoForm("rg.d", undefined);
    }),
  editRegion: (_e, t) =>
    guarded(() => {
      const r = store.getMap().regions[id(t)];
      if (!r) return;
      regionEdit = r.id;
      f["rg.name"] = r.name;
      rulesIntoForm("rg", r);
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
  const preview = el.type === "text" ? el.parentElement?.querySelector(".pf1hex-icon-preview") : null;
  if (preview) preview.className = `fa-solid ${normalizeIcon(el.value) ?? el.placeholder} pf1hex-icon-preview`;
  if (el.type === "range") {
    const readout = el.parentElement?.querySelector(".hint");
    if (readout) readout.textContent = `${el.value}%`;
  }
  if (event.type === "change" && el.name === "tag") app?.render();
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

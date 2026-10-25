// Store: where each piece of state lives. Whole-state objects are written as JSON strings
// because setFlag/settings merge objects instead of replacing them.
import type { StoreApi, SupplyItem } from "../contracts";
import { engine } from "../engine";
import {
  MODULE_ID,
  CARAVAN_TYPE,
  type Change,
  type CaravanSettings,
  type CaravanState,
  type HexKey,
  type KnowledgeState,
  type MapData,
  type Pack,
  type PartyMap,
  type Region,
  type RoleDef,
  type SupplyTrack,
} from "../types";

const PACK_FORMAT = "pf1-hexploration-pack";
const listeners = new Set<() => void>();

export function defaultCaravan(): CaravanState {
  return {
    roster: [],
    wagon: { condition: 11, max: 11 },
    draftRequired: 0,
    sceneId: null,
    position: null,
    journeyDay: 0,
    consecutiveForcedMarch: 0,
    leg: null,
  };
}

export function emptyMap(): MapData {
  return { hexes: {}, regions: {}, landmarks: {}, routes: {} };
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function requireGM(): void {
  if (!game.user?.isGM) throw new Error("GM only");
}

function getScene(sceneId?: string): any | null {
  const id = sceneId ?? canvas?.scene?.id;
  return id ? (game.scenes?.get(id) ?? null) : null;
}

function requireScene(sceneId?: string): any {
  const scene = getScene(sceneId);
  if (!scene) throw new Error("No scene");
  return scene;
}

function requireCaravanActor(): any {
  const actor = store.getCaravanActor();
  if (!actor) throw new Error("No caravan actor");
  return actor;
}

function isSupplyTrack(value: unknown): value is SupplyTrack {
  return value === "rations" || value === "water";
}

/** A region as the party may see it: identity only, no tables or DC tuning. */
function publicRegion(region: Region): Region {
  return {
    id: region.id,
    name: region.name,
    color: region.color,
    encounterTable: null,
    dcMods: {},
    waterMultiplier: 1,
    stormThreshold: null,
  };
}

export const store = {
  registerSettings() {
    const register = (key: string) =>
      game.settings.register(MODULE_ID, key, { scope: "world", config: false, type: String, default: "" });
    register("caravanActor");
    register("roles");
    register("settings");

    const caravanUuid = () => game.settings.get(MODULE_ID, "caravanActor") as string;
    const relevantActor = (actor: any) =>
      !!actor && (actor.uuid === caravanUuid() || store.getCaravan().roster.some((m) => m.actorUuid === actor.uuid));
    Hooks.on("updateActor", (actor: any) => relevantActor(actor) && store.notify());
    for (const hook of ["updateItem", "createItem", "deleteItem"]) {
      Hooks.on(hook, (item: any) => item?.parent?.uuid === caravanUuid() && store.notify());
    }
    Hooks.on("updateScene", (_scene: any, changes: any) => changes?.flags?.[MODULE_ID] !== undefined && store.notify());
    Hooks.on("updateSetting", (setting: any) => String(setting?.key ?? "").startsWith(`${MODULE_ID}.`) && store.notify());
  },

  getCaravanActor() {
    const uuid = game.settings.get(MODULE_ID, "caravanActor") as string;
    const designated = uuid ? fromUuidSync(uuid) : null;
    return designated ?? game.actors?.find((a: any) => a.type === CARAVAN_TYPE) ?? null;
  },

  async setCaravanActor(uuid: string | null) {
    requireGM();
    await game.settings.set(MODULE_ID, "caravanActor", uuid ?? "");
    store.notify();
  },

  getCaravan(): CaravanState {
    const actor = store.getCaravanActor();
    const saved = parseJson<Partial<CaravanState>>(actor?.getFlag(MODULE_ID, "caravan"), {});
    return { ...defaultCaravan(), ...saved };
  },

  async setCaravan(next: CaravanState) {
    requireGM();
    await requireCaravanActor().setFlag(MODULE_ID, "caravan", JSON.stringify(next));
    store.notify();
  },

  getSettings(): CaravanSettings {
    const saved = parseJson<Partial<CaravanSettings>>(game.settings.get(MODULE_ID, "settings"), {});
    return { ...engine.DEFAULT_SETTINGS, ...saved };
  },

  getRoles(): RoleDef[] {
    const saved = parseJson<RoleDef[] | null>(game.settings.get(MODULE_ID, "roles"), null);
    return Array.isArray(saved) ? saved : engine.DEFAULT_ROLES;
  },

  async setRoles(roles: RoleDef[]) {
    requireGM();
    await game.settings.set(MODULE_ID, "roles", JSON.stringify(roles));
    store.notify();
  },

  getMap(sceneId?: string): MapData {
    const saved = parseJson<Partial<MapData>>(getScene(sceneId)?.getFlag(MODULE_ID, "map"), {});
    return { ...emptyMap(), ...saved };
  },

  async setMap(map: MapData, sceneId?: string) {
    requireGM();
    await requireScene(sceneId).setFlag(MODULE_ID, "map", JSON.stringify(map));
    store.notify();
  },

  getPartyMap(sceneId?: string): PartyMap {
    const saved = parseJson<Partial<PartyMap>>(getScene(sceneId)?.getFlag(MODULE_ID, "knowledge"), {});
    return { knowledge: { ...(saved.knowledge ?? {}) } };
  },

  async setKnowledge(sceneId: string, keys: HexKey[], state: KnowledgeState) {
    requireGM();
    const scene = requireScene(sceneId);
    const party = store.getPartyMap(scene.id);
    for (const key of keys) {
      if (state === "unknown") delete party.knowledge[key];
      else party.knowledge[key] = state;
    }
    await scene.setFlag(MODULE_ID, "knowledge", JSON.stringify(party));
    store.notify();
  },

  partyView(sceneId?: string): MapData {
    const map = store.getMap(sceneId);
    const { knowledge } = store.getPartyMap(sceneId);
    const view = emptyMap();
    if (map.baseColor) view.baseColor = map.baseColor;

    for (const [key, state] of Object.entries(knowledge)) {
      const hex = map.hexes[key];
      if (!hex || (state !== "explored" && state !== "mapped")) continue;
      const tags = state === "explored" ? hex.tags.filter((t) => t !== "secret") : [...hex.tags];
      view.hexes[key] = { ...hex, tags };
      const region = hex.region ? map.regions[hex.region] : undefined;
      if (region) view.regions[region.id] = publicRegion(region);
    }
    for (const route of Object.values(map.routes)) {
      if (route.knownToParty) view.routes[route.id] = structuredClone(route);
    }
    for (const landmark of Object.values(map.landmarks)) {
      if (landmark.knownToParty || view.hexes[landmark.hex]) view.landmarks[landmark.id] = { ...landmark };
    }
    return view;
  },

  supplyItems(): SupplyItem[] {
    const actor = store.getCaravanActor();
    if (!actor) return [];
    const loose: SupplyItem[] = [];
    const packed: SupplyItem[] = [];
    // A container counts its contents: each content item uses its own supply flag, else the container's.
    const visit = (items: Iterable<any>, container: any | null, inherited: unknown) => {
      for (const item of items ?? []) {
        const flag = item.getFlag?.(MODULE_ID, "supply");
        if (item.type === "container") {
          visit(item.items ?? [], item, isSupplyTrack(flag) ? flag : inherited);
          continue;
        }
        const track = isSupplyTrack(flag) ? flag : inherited;
        if (!isSupplyTrack(track)) continue;
        const units = Number(item.getFlag?.(MODULE_ID, "units"));
        (container ? packed : loose).push({ item, track, unitsPerQuantity: units > 0 ? units : 1, container });
      }
    };
    visit(actor.items ?? [], null, null);
    return [...loose, ...packed];
  },

  async setSupplyQuantity(supply: SupplyItem, quantity: number): Promise<Change> {
    requireGM();
    const before = Number(supply.item.system?.quantity ?? 0);
    const after = Math.max(0, Math.round(quantity));
    if (supply.container) {
      await supply.container.updateContainerContents([{ _id: supply.item.id, "system.quantity": after }]);
      return { kind: "itemQuantity", itemUuid: supply.item.uuid ?? "", before, after, containerUuid: supply.container.uuid, itemId: supply.item.id };
    }
    await supply.item.update({ "system.quantity": after });
    return { kind: "itemQuantity", itemUuid: supply.item.uuid, before, after };
  },

  supplyTotals() {
    const totals = { rations: 0, water: 0 };
    for (const { item, track, unitsPerQuantity } of store.supplyItems()) {
      totals[track] += (Number(item.system?.quantity) || 0) * unitsPerQuantity;
    }
    return totals;
  },

  onChange(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },

  notify() {
    for (const cb of [...listeners]) {
      try {
        cb();
      } catch (err) {
        console.error(`${MODULE_ID} | change listener failed`, err);
      }
    }
  },

  async importPack(pack: Pack, sceneId?: string) {
    requireGM();
    if (pack?.format !== PACK_FORMAT) throw new Error("Not a PF1 Hexploration pack");
    if (pack.version !== 1) throw new Error(`Unsupported pack version: ${String(pack.version)}`);
    if (pack.roles) await store.setRoles(pack.roles);
    if (pack.settings) {
      await game.settings.set(MODULE_ID, "settings", JSON.stringify({ ...store.getSettings(), ...pack.settings }));
    }
    if (pack.map) await store.setMap({ ...emptyMap(), ...pack.map }, sceneId);
    store.notify();
  },

  exportPack(name: string, sceneId?: string): Pack {
    return {
      format: PACK_FORMAT,
      version: 1,
      name,
      roles: store.getRoles(),
      settings: store.getSettings(),
      map: store.getMap(sceneId),
    };
  },
} satisfies StoreApi;

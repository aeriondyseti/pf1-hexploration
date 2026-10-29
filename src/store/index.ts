// Store: where each piece of state lives. Whole-state objects are written as JSON strings
// because setFlag/settings merge objects instead of replacing them.
import type { StoreApi, SupplyItem } from "../contracts";
import { MAP_VERSION, migrateMap } from "./migrate";
import {
  MODULE_ID,
  CARAVAN_TYPE,
  ROLE_IDS,
  type CaravanSettings,
  type CaravanState,
  type HexKey,
  type KnowledgeState,
  type MapData,
  type PartyMap,
  type Region,
  type SupplyTrack,
  type Traveller,
  type VehicleLink,
} from "../types";

const listeners = new Set<() => void>();

export function defaultCaravan(): CaravanState {
  return {
    travellers: [],
    vehicles: [],
    roles: {},
    funds: 0,
    sceneId: null,
    position: null,
    journeyDay: 0,
    plan: { activity: "travel", course: [], routeId: null, lastEdit: null },
    trip: null,
  };
}

const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Read a saved caravan (current or 0.1.x format) into the current shape. */
export function migrateCaravan(saved: any): CaravanState {
  const base = defaultCaravan();
  if (!saved || typeof saved !== "object") return base;
  const travellers: Traveller[] = Array.isArray(saved.travellers)
    ? saved.travellers
    : Array.isArray(saved.roster)
      ? saved.roster.map((m: any) => ({
          actorUuid: String(m.actorUuid),
          name: String(m.name ?? ""),
          food: finite(m.food, 1),
          water: finite(m.water, 1),
          wage: 0,
          seat: null,
        }))
      : [];
  const vehicles: VehicleLink[] = Array.isArray(saved.vehicles) ? saved.vehicles : [];
  const roles: CaravanState["roles"] = {};
  if (saved.roles && typeof saved.roles === "object") {
    for (const id of ROLE_IDS) {
      const holder = saved.roles[id];
      if (typeof holder === "string" || holder === null) roles[id] = holder;
    }
  }
  const plan = saved.plan && typeof saved.plan === "object" ? { ...base.plan, ...saved.plan } : base.plan;
  return {
    travellers,
    vehicles,
    roles,
    funds: finite(saved.funds, 0),
    sceneId: typeof saved.sceneId === "string" ? saved.sceneId : null,
    position: typeof saved.position === "string" ? saved.position : null,
    journeyDay: finite(saved.journeyDay, 0),
    plan,
    trip: saved.trip && typeof saved.trip === "object" ? saved.trip : null,
  };
}

export function emptyMap(): MapData {
  return { hexes: {}, regions: {}, landmarks: {}, routes: {}, version: MAP_VERSION };
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
    rationsMultiplier: 1,
    waterMultiplier: 1,
  };
}

export const store = {
  registerSettings() {
    const register = (key: string) =>
      game.settings.register(MODULE_ID, key, { scope: "world", config: false, type: String, default: "" });
    register("caravanActor");
    register("settings");

    const caravanUuid = () => store.getCaravanActor()?.uuid ?? "";
    const linked = (uuid: string | undefined, vehiclesOnly: boolean) => {
      if (!uuid) return false;
      if (uuid === caravanUuid()) return true;
      const c = store.getCaravan();
      return c.vehicles.some((v) => v.actorUuid === uuid) || (!vehiclesOnly && c.travellers.some((t) => t.actorUuid === uuid));
    };
    Hooks.on("updateActor", (actor: any) => linked(actor?.uuid, false) && store.notify());
    for (const hook of ["updateItem", "createItem", "deleteItem"]) {
      // Items inside a container report the container's actor as their (grand)parent.
      Hooks.on(hook, (item: any) => {
        const owner = item?.parent?.documentName === "Item" ? item.parent.parent : (item?.actor ?? item?.parent);
        if (linked(owner?.uuid, true)) store.notify();
      });
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
    return migrateCaravan(parseJson<any>(actor?.getFlag(MODULE_ID, "caravan"), {}));
  },

  async setCaravan(next: CaravanState) {
    requireGM();
    await requireCaravanActor().setFlag(MODULE_ID, "caravan", JSON.stringify(next));
    store.notify();
  },

  getSettings(): CaravanSettings {
    const saved = parseJson<any>(game.settings.get(MODULE_ID, "settings"), {});
    return { doublingPenalty: finite(saved?.doublingPenalty, 4) };
  },

  getMap(sceneId?: string): MapData {
    const saved = parseJson<any>(getScene(sceneId)?.getFlag(MODULE_ID, "map"), {});
    if (saved?.version !== MAP_VERSION) return migrateMap(saved);
    return { ...emptyMap(), ...saved };
  },

  async setMap(map: MapData, sceneId?: string) {
    requireGM();
    await requireScene(sceneId).setFlag(MODULE_ID, "map", JSON.stringify(map));
    store.notify();
  },

  getPartyMap(sceneId?: string): PartyMap {
    const saved = parseJson<Partial<PartyMap>>(getScene(sceneId)?.getFlag(MODULE_ID, "knowledge"), {});
    return { knowledge: { ...(saved.knowledge ?? {}) }, revealed: Array.isArray(saved.revealed) ? [...saved.revealed] : [] };
  },

  async setPartyMap(sceneId: string, party: PartyMap) {
    requireGM();
    const next: PartyMap = { knowledge: { ...(party.knowledge ?? {}) }, revealed: [...(party.revealed ?? [])] };
    await requireScene(sceneId).setFlag(MODULE_ID, "knowledge", JSON.stringify(next));
    store.notify();
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
    const { knowledge, revealed } = store.getPartyMap(sceneId);
    const shown = new Set(revealed ?? []);
    const view = emptyMap();
    if (map.baseColor) view.baseColor = map.baseColor;

    for (const [key, state] of Object.entries(knowledge)) {
      const hex = map.hexes[key];
      if (!hex || (state !== "explored" && state !== "mapped")) continue;
      // A Secret element shows only once the hex is explored to the end (DESIGN §4.3).
      const tags = shown.has(key) ? [...hex.tags] : hex.tags.filter((t) => t !== "secret");
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
    const loose: SupplyItem[] = [];
    const packed: SupplyItem[] = [];
    for (const link of store.getCaravan().vehicles) {
      let vehicle: any = null;
      try {
        vehicle = fromUuidSync(link.actorUuid);
      } catch {
        vehicle = null;
      }
      if (!vehicle) continue;
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
          (container ? packed : loose).push({
            item,
            track,
            unitsPerQuantity: units > 0 ? units : 1,
            container,
            vehicleUuid: link.actorUuid,
          });
        }
      };
      visit(vehicle.items ?? [], null, null);
    }
    return [...loose, ...packed];
  },

  async setSupplyQuantity(supply: SupplyItem, quantity: number): Promise<void> {
    requireGM();
    const after = Math.max(0, Math.round(quantity));
    if (supply.container) {
      await supply.container.updateContainerContents([{ _id: supply.item.id, "system.quantity": after }]);
      return;
    }
    await supply.item.update({ "system.quantity": after });
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
} satisfies StoreApi;

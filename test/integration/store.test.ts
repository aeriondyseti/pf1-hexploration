import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld, useClient, type FakeActor, type FakeScene } from "../fakes/foundry";
import { MODULE_ID, type MapData } from "../../src/types";

vi.mock("../../src/engine", () => ({
  engine: {
    DEFAULT_ROLES: [{ id: "scout" }],
    DEFAULT_SETTINGS: { doublingPenalty: 4, forcedMarchBaseDc: 10, forcedMarchStep: 2 },
  },
}));

import { store } from "../../src/store";

function sampleMap(): MapData {
  const hex = (key: string, extra: object = {}) => ({
    key,
    terrain: "desert",
    difficulty: "standard" as const,
    region: "dunes",
    tags: [] as string[],
    ...extra,
  });
  const route = (id: string, hexes: string[], knownToParty: boolean) => ({
    id, name: id, hexes, from: "0,0", days: hexes.length, difficulty: "easy" as const,
    encounterBonus: 0, bargain: "", effects: [], prompts: [], knownToParty,
  });
  return {
    hexes: {
      "0,0": hex("0,0", { tags: ["secret", "resource"] }),
      "0,1": hex("0,1", { tags: ["secret"] }),
      "0,2": hex("0,2"),
      "5,5": hex("5,5", { region: "hidden" }),
    },
    regions: {
      dunes: { id: "dunes", name: "Dunes", color: "#c90", encounterTable: "RollTable.x", dcMods: { "*": 2 }, waterMultiplier: 2, stormThreshold: 25 },
      hidden: { id: "hidden", name: "Hidden", color: "#000", encounterTable: null, dcMods: {}, waterMultiplier: 1, stormThreshold: null },
    },
    landmarks: {
      oasis: { id: "oasis", name: "Oasis", hex: "0,1", description: "", knownToParty: false },
      tomb: { id: "tomb", name: "Tomb", hex: "5,5", description: "", knownToParty: false },
      tower: { id: "tower", name: "Tower", hex: "5,5", description: "", knownToParty: true },
    },
    routes: { known: route("known", ["0,1"], true), secret: route("secret", ["5,5"], false) },
  };
}

describe("store", () => {
  let world: ReturnType<typeof createWorld>;
  let caravan: FakeActor;
  let scene: FakeScene;

  beforeEach(async () => {
    world = createWorld();
    store.registerSettings();
    scene = world.createScene({ name: "Desert" });
    caravan = world.createActor({ name: "Caravan" });
    await store.setCaravanActor(caravan.uuid);
  });

  it("returns caravan defaults and round-trips state as a whole", async () => {
    expect(store.getCaravan()).toMatchObject({ roster: [], wagon: { condition: 11, max: 11 }, leg: null, journeyDay: 0 });
    await store.setCaravan({ ...store.getCaravan(), journeyDay: 3, position: "0,1" });
    expect(store.getCaravan()).toMatchObject({ journeyDay: 3, position: "0,1" });
    expect(typeof caravan.getFlag(MODULE_ID, "caravan")).toBe("string");
  });

  it("rejects GM-only writes from a player client", async () => {
    useClient(world, world.player);
    await expect(store.setCaravan(store.getCaravan())).rejects.toThrow("GM only");
    await expect(store.setMap(sampleMap())).rejects.toThrow("GM only");
    await expect(store.setKnowledge(scene.id, ["0,0"], "mapped")).rejects.toThrow("GM only");
    await expect(store.setRoles([])).rejects.toThrow("GM only");
    await expect(store.setCaravanActor(null)).rejects.toThrow("GM only");
  });

  it("partyView hides unknown hexes, unknown routes, secret tags on explored hexes and region tables", async () => {
    await store.setMap(sampleMap());
    await store.setKnowledge(scene.id, ["0,0"], "explored");
    await store.setKnowledge(scene.id, ["0,1"], "mapped");
    useClient(world, world.player);
    const view = store.partyView();

    expect(Object.keys(view.hexes).sort()).toEqual(["0,0", "0,1"]);
    expect(view.hexes["0,0"].tags).toEqual(["resource"]);
    expect(view.hexes["0,1"].tags).toEqual(["secret"]);
    expect(Object.keys(view.routes)).toEqual(["known"]);
    expect(Object.keys(view.regions)).toEqual(["dunes"]);
    expect(view.regions.dunes).toMatchObject({ name: "Dunes", color: "#c90", encounterTable: null, dcMods: {}, stormThreshold: null });
    expect(Object.keys(view.landmarks).sort()).toEqual(["oasis", "tower"]);
    // GM truth is untouched.
    expect(store.getMap().hexes["0,0"].tags).toContain("secret");
  });

  it("setKnowledge with 'unknown' forgets the hex", async () => {
    await store.setKnowledge(scene.id, ["0,0", "0,1"], "explored");
    await store.setKnowledge(scene.id, ["0,0"], "unknown");
    expect(store.getPartyMap(scene.id).knowledge).toEqual({ "0,1": "explored" });
  });

  it("sums supplies as quantity x units from flagged hold items", () => {
    caravan.createItem({ name: "Rations", system: { quantity: 5 }, flags: { [MODULE_ID]: { supply: "rations", units: 4 } } });
    caravan.createItem({ name: "Trail food", system: { quantity: 3 }, flags: { [MODULE_ID]: { supply: "rations" } } });
    caravan.createItem({ name: "Waterskins", system: { quantity: 2 }, flags: { [MODULE_ID]: { supply: "water", units: 10 } } });
    caravan.createItem({ name: "Empty barrel", system: {}, flags: { [MODULE_ID]: { supply: "water" } } });
    caravan.createItem({ name: "Rope", system: { quantity: 50 } });
    expect(store.supplyItems()).toHaveLength(4);
    expect(store.supplyTotals()).toEqual({ rations: 23, water: 20 });
  });

  it("notifies listeners on relevant document changes only", async () => {
    const item = caravan.createItem({ name: "Rations", system: { quantity: 5 }, flags: { [MODULE_ID]: { supply: "rations" } } });
    const other = world.createActor({ name: "Bystander" });
    const cb = vi.fn();
    const off = store.onChange(cb);
    await other.update({ name: "Renamed" });
    expect(cb).not.toHaveBeenCalled();
    await item.update({ "system.quantity": 4 });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    await item.update({ "system.quantity": 3 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("imports and exports packs, rejecting the wrong format", async () => {
    expect(store.getRoles()).toEqual([{ id: "scout" }]);
    await store.importPack({
      format: "pf1-hexploration-pack", version: 1, name: "Test",
      roles: [], settings: { doublingPenalty: 2 }, map: sampleMap(),
    });
    const pack = store.exportPack("Out");
    expect(pack).toMatchObject({ format: "pf1-hexploration-pack", version: 1, name: "Out", roles: [] });
    expect(pack.settings).toEqual({ doublingPenalty: 2, forcedMarchBaseDc: 10, forcedMarchStep: 2 });
    expect(Object.keys(pack.map!.hexes)).toHaveLength(4);
    await expect(store.importPack({ format: "nope" } as any)).rejects.toThrow();
    await expect(store.importPack({ format: "pf1-hexploration-pack", version: 2 } as any)).rejects.toThrow("version");
  });
});

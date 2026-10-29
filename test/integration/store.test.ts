import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld, useClient, type FakeActor, type FakeScene } from "../fakes/foundry";
import { MODULE_ID, type HexRecord, type MapData, type Route } from "../../src/types";

import { store } from "../../src/store";

function sampleMap(): MapData {
  const hex = (key: string, extra: Partial<HexRecord> = {}): HexRecord => ({
    key,
    terrain: "desert-sandy",
    region: "dunes",
    tags: [],
    ...extra,
  });
  const route = (id: string, hexes: string[], knownToParty: boolean): Route => ({
    id, name: id, hexes, from: "0,0", kind: "road", knownToParty,
  });
  return {
    version: 2,
    defaults: { terrain: "plains", tags: [] },
    rules: { encounterTable: "RollTable.m", dcMods: { "*": 1 }, rationsMultiplier: 1, waterMultiplier: 1 },
    hexes: {
      "0,0": hex("0,0", { tags: ["secret", "resource"] }),
      "0,1": hex("0,1", { tags: ["secret"] }),
      "0,2": hex("0,2"),
      "5,5": hex("5,5", { region: "hidden" }),
    },
    regions: {
      dunes: {
        id: "dunes", name: "Dunes", color: "#c90", encounterTable: "RollTable.x", dcMods: { "*": 2 }, rationsMultiplier: 1.5,
        waterMultiplier: 2, defaults: { terrain: "desert-sandy", tags: ["standard"] },
      },
      hidden: { id: "hidden", name: "Hidden", color: "#000", encounterTable: null, dcMods: {}, rationsMultiplier: 1, waterMultiplier: 1 },
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
    expect(store.getCaravan()).toMatchObject({ travellers: [], vehicles: [], roles: {}, funds: 0, trip: null, journeyDay: 0 });
    await store.setCaravan({ ...store.getCaravan(), journeyDay: 3, position: "0,1" });
    expect(store.getCaravan()).toMatchObject({ journeyDay: 3, position: "0,1" });
    expect(typeof caravan.getFlag(MODULE_ID, "caravan")).toBe("string");
  });

  it("rejects GM-only writes from a player client", async () => {
    useClient(world, world.player);
    await expect(store.setCaravan(store.getCaravan())).rejects.toThrow("GM only");
    await expect(store.setMap(sampleMap())).rejects.toThrow("GM only");
    await expect(store.setKnowledge(scene.id, ["0,0"], "mapped")).rejects.toThrow("GM only");
    await expect(store.setCaravanActor(null)).rejects.toThrow("GM only");
  });

  it("partyView hides unknown hexes, unknown routes, unrevealed secrets, region rules and map rules", async () => {
    await store.setMap(sampleMap());
    await store.setKnowledge(scene.id, ["0,0"], "explored");
    await store.setKnowledge(scene.id, ["0,1"], "mapped");
    useClient(world, world.player);
    let view = store.partyView();

    expect(Object.keys(view.hexes).sort()).toEqual(["0,0", "0,1"]);
    // Secret shows only once the hex is explored to the end (revealed), Mapped or not.
    expect(view.hexes["0,0"].tags).toEqual(["resource"]);
    expect(view.hexes["0,1"].tags).toEqual([]);
    expect(Object.keys(view.routes)).toEqual(["known"]);
    expect(Object.keys(view.regions)).toEqual(["dunes"]);
    expect(view.regions.dunes).toEqual({
      id: "dunes", name: "Dunes", color: "#c90", encounterTable: null, dcMods: {}, rationsMultiplier: 1, waterMultiplier: 1,
    });
    expect(view.rules).toBeUndefined();
    expect(view.defaults).toBeUndefined();
    expect(Object.keys(view.landmarks).sort()).toEqual(["oasis", "tower"]);
    // GM truth is untouched.
    expect(store.getMap().hexes["0,0"].tags).toContain("secret");

    useClient(world, world.gm);
    await store.setPartyMap(scene.id, { ...store.getPartyMap(scene.id), revealed: ["0,1"] });
    useClient(world, world.player);
    view = store.partyView();
    expect(view.hexes["0,1"].tags).toEqual(["secret"]);
    expect(view.hexes["0,0"].tags).toEqual(["resource"]);
  });

  it("setPartyMap writes knowledge and revealed as a whole (GM only)", async () => {
    await store.setKnowledge(scene.id, ["0,0"], "mapped");
    await store.setPartyMap(scene.id, { knowledge: { "1,1": "explored" }, revealed: ["1,1"] });
    expect(store.getPartyMap(scene.id)).toEqual({ knowledge: { "1,1": "explored" }, revealed: ["1,1"] });
    await store.setKnowledge(scene.id, ["2,2"], "mapped");
    expect(store.getPartyMap(scene.id).revealed).toEqual(["1,1"]);
    useClient(world, world.player);
    await expect(store.setPartyMap(scene.id, { knowledge: {} })).rejects.toThrow("GM only");
  });

  it("getMap migrates 0.1.x data on load", async () => {
    await scene.setFlag(MODULE_ID, "map", JSON.stringify({
      hexes: { "0,0": { key: "0,0", terrain: "oasis", difficulty: "easy", region: null, tags: ["ruins"], encounterMod: 2 } },
      regions: {}, landmarks: {},
      routes: { r: { id: "r", name: "R", from: "0,0", hexes: ["0,1"], days: 2, difficulty: "easy", encounterBonus: 0, bargain: "", effects: [], prompts: [], knownToParty: true } },
    }));
    const map = store.getMap(scene.id);
    expect(map.version).toBe(2);
    expect(map.hexes["0,0"]).toEqual({ key: "0,0", terrain: "plains", region: null, tags: ["resource"] });
    expect(map.routes.r).toEqual({ id: "r", name: "R", from: "0,0", hexes: ["0,1"], kind: "road", knownToParty: true });
    // Version-2 data round-trips unchanged.
    await store.setMap(sampleMap());
    expect(store.getMap()).toEqual(sampleMap());
  });

  it("setKnowledge with 'unknown' forgets the hex", async () => {
    await store.setKnowledge(scene.id, ["0,0", "0,1"], "explored");
    await store.setKnowledge(scene.id, ["0,0"], "unknown");
    expect(store.getPartyMap(scene.id)).toEqual({ knowledge: { "0,1": "explored" }, revealed: [] });
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

});

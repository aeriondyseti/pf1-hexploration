// Caravan state migration from 0.1.x, and the pf1 adapter's caravan defaults.
import { beforeEach, describe, expect, it } from "vitest";
import { createWorld, useClient, type FakeActor, type FakeWorld } from "../fakes/foundry";
import { store } from "../../src/store";
import { pf1Adapter } from "../../src/pf1";
import { CARAVAN_TYPE, MODULE_ID } from "../../src/types";

let world: FakeWorld & { gm: any; player: any };
let caravanActor: FakeActor;

beforeEach(() => {
  world = createWorld();
  store.registerSettings();
  useClient(world, world.gm);
  world.createScene({ id: "scene1" });
  caravanActor = world.createActor({ name: "Company", type: CARAVAN_TYPE });
});

describe("0.1.x caravan state", () => {
  it("migrates the old roster to travellers and drops the wagon, draft and leg fields", async () => {
    await caravanActor.setFlag(
      MODULE_ID,
      "caravan",
      JSON.stringify({
        roster: [{ actorUuid: "Actor.a", name: "Atan", food: 2, water: 2, draft: true, npc: true }],
        wagon: { condition: 7, max: 11 },
        draftRequired: 2,
        sceneId: "scene1",
        position: "3,4",
        journeyDay: 5,
        consecutiveForcedMarch: 1,
        leg: { status: "underway" },
      }),
    );
    expect(store.getCaravan()).toEqual({
      travellers: [{ actorUuid: "Actor.a", name: "Atan", food: 2, water: 2, wage: 0, seat: null }],
      vehicles: [],
      roles: {},
      funds: 0,
      sceneId: "scene1",
      position: "3,4",
      journeyDay: 5,
      plan: { activity: "travel", course: [], routeId: null, lastEdit: null },
      trip: null,
    });
  });

  it("defaults the settings' doubling penalty to 4", () => {
    expect(store.getSettings()).toEqual({ doublingPenalty: 4 });
  });
});

describe("pf1 adapter defaults", () => {
  it("vehicle defaults by name", () => {
    const v = (name: string) => pf1Adapter.vehicleFor(world.createActor({ name, type: "vehicle" }));
    expect(v("Pony Cart")).toMatchObject({ teamRequired: 1, seats: 2, cargoCapacity: 300, milesPerDay: 16 });
    expect(v("Heavy Wagon")).toMatchObject({ teamRequired: 4, seats: 4, cargoCapacity: 4000 });
    expect(v("Light wagon")).toMatchObject({ teamRequired: 1, cargoCapacity: 1000 });
    expect(v("Wagon")).toMatchObject({ teamRequired: 2, cargoCapacity: 2000 });
    expect(v("Carriage")).toMatchObject({ teamRequired: 1, cargoCapacity: 300 });
    expect(v("Raft")).toMatchObject({ teamRequired: 1, seats: 4, cargoCapacity: 1000 });
  });

  it("rider weight, pull strength, speed, coins and conditions", async () => {
    const horse = world.createActor({
      name: "Horse",
      type: "npc",
      statuses: ["fatigued"],
      system: { traits: { size: "lg" }, attributes: { speed: { land: { total: 50 } }, encumbrance: { carriedWeight: 20 } } },
    });
    expect(pf1Adapter.riderWeight(horse)).toBe(1420);
    expect(pf1Adapter.pullStrength(horse)).toBe(1);
    expect(pf1Adapter.landSpeed(horse)).toBe(50);
    expect(pf1Adapter.conditions(horse)).toEqual(["Fatigued"]);
    const pc = world.createActor({ name: "Mira", type: "character" });
    expect(pf1Adapter.landSpeed(pc)).toBe(30);
    expect(pf1Adapter.pullStrength(pc)).toBe(0.5); // no size: Medium
    await pf1Adapter.setCoins(pc, { pp: 1, gp: 2, sp: 3, cp: 4 });
    expect(pf1Adapter.coins(pc)).toEqual({ pp: 1, gp: 2, sp: 3, cp: 4 });
  });

  it("rolls skills with no dialog and no chat card, labelling the doubling penalty", async () => {
    const pc = world.createActor({ name: "Mira", type: "character", skillTotal: 17 });
    expect(await pf1Adapter.rollSkill(pc, "sur", 4)).toBe(17);
    expect(pc.skillCalls.at(-1)!.options).toEqual({ skipDialog: true, chatMessage: false, bonus: "-4[Doubling]" });
  });
});

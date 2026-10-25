// Adding to the roster (the Add button and actor drag-and-drop share addToRoster).
import { beforeEach, describe, expect, it } from "vitest";
import { createWorld, useClient, type FakeActor, type FakeWorld } from "../fakes/foundry";
import { store } from "../../src/store";
import { addToRoster } from "../../src/ui/caravan-app";
import { CARAVAN_TYPE } from "../../src/types";

let world: FakeWorld & { gm: any; player: any };
let caravan: FakeActor;

beforeEach(() => {
  world = createWorld();
  store.registerSettings();
  useClient(world, world.gm);
  world.createScene({ id: "scene1" });
  caravan = world.createActor({ name: "Wagon", type: CARAVAN_TYPE });
});

describe("addToRoster", () => {
  it("adds a party actor once and refuses duplicates and caravans", async () => {
    const camel = world.createActor({ name: "Atan", type: "npc", system: { traits: { size: { base: "lg", value: 5 } } } });
    await addToRoster(camel, true);
    await addToRoster(camel);
    await addToRoster(world.createActor({ name: "Other wagon", type: CARAVAN_TYPE }));

    const roster = store.getCaravan().roster;
    expect(roster.map((m) => m.name)).toEqual(["Atan"]);
    expect(roster[0]).toMatchObject({ actorUuid: camel.uuid, draft: true });
    expect(store.getCaravanActor()?.uuid).toBe(caravan.uuid);
  });

  it("does nothing on a player client", async () => {
    const pc = world.createActor({ name: "Sabrina", type: "character" });
    useClient(world, world.player);
    await addToRoster(pc);
    useClient(world, world.gm);
    expect(store.getCaravan().roster).toEqual([]);
  });
});

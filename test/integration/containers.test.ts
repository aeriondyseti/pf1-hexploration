// Supplies live in the linked vehicles' inventories (DESIGN §4.9): loose items first, then container contents;
// a flagged container counts its contents; a ration in a PC's own pack doesn't count.
import { beforeEach, describe, expect, it } from "vitest";
import { createWorld, useClient, FakeDocument, type FakeActor, type FakeWorld } from "../fakes/foundry";
import { caravan } from "../../src/caravan";
import { store } from "../../src/store";
import { pf1Adapter } from "../../src/pf1";
import { CARAVAN_TYPE, MODULE_ID } from "../../src/types";

let world: FakeWorld & { gm: any; player: any };
let caravanActor: FakeActor;
let wagon: FakeActor;

/** A pf1-style container: contents in `items`, changed only through updateContainerContents. */
function addCrate(actor: FakeActor, name: string, supply: string | null, contents: { name: string; quantity: number; weight?: number }[]) {
  const crate: any = actor.createItem({
    name,
    type: "container",
    system: { quantity: 1, weight: { value: 10 } },
    flags: supply ? { [MODULE_ID]: { supply } } : {},
  });
  crate.items = contents.map(
    (c) => new FakeDocument(world as any, "Item", { name: c.name, system: { quantity: c.quantity, weight: { value: c.weight ?? 1 } } }, crate),
  );
  crate.items.get = (id: string) => crate.items.find((i: any) => i.id === id);
  crate.updateContainerContents = async (updates: any[]) => {
    for (const u of updates) {
      const inner = crate.items.get(u._id);
      if (inner) inner.system.quantity = u["system.quantity"];
    }
  };
  return crate;
}

beforeEach(async () => {
  world = createWorld();
  store.registerSettings();
  useClient(world, world.gm);
  world.createScene({ id: "scene1" });
  caravanActor = world.createActor({ name: "Company", type: CARAVAN_TYPE });
  wagon = world.createActor({ name: "Light Wagon", type: "vehicle" });
  await caravan.add(wagon.uuid);
});

describe("caravan subtype", () => {
  it("falls back to the first caravan-type actor when none is designated", () => {
    world.createActor({ name: "Not a caravan", type: "npc" });
    expect(store.getCaravanActor()?.uuid).toBe(caravanActor.uuid);
  });
});

describe("vehicle supplies", () => {
  it("lists loose supplies before container contents, from linked vehicles only", async () => {
    const crate = addCrate(wagon, "Ration crate", "rations", [{ name: "Trail Rations", quantity: 10 }]);
    wagon.createItem({ name: "Loose rations", system: { quantity: 2 }, flags: { [MODULE_ID]: { supply: "rations" } } });
    wagon.createItem({ name: "Waterskins", system: { quantity: 4 }, flags: { [MODULE_ID]: { supply: "water", units: 0.5 } } });
    addCrate(wagon, "Unflagged chest", null, [{ name: "Trail Rations", quantity: 5 }]);
    // A ration in a PC's own pack does not count, even with the PC in the caravan.
    const pc = world.createActor({ name: "Mira", type: "character" });
    pc.createItem({ name: "Pack rations", system: { quantity: 7 }, flags: { [MODULE_ID]: { supply: "rations" } } });
    await caravan.add(pc.uuid);
    // Nor does one on the Caravan actor itself.
    caravanActor.createItem({ name: "Old hold", system: { quantity: 9 }, flags: { [MODULE_ID]: { supply: "rations" } } });

    const supplies = store.supplyItems();
    expect(supplies.map((s) => s.item.name)).toEqual(["Loose rations", "Waterskins", "Trail Rations"]);
    expect(supplies[0]).toMatchObject({ container: null, vehicleUuid: wagon.uuid });
    expect(supplies[2].container).toBe(crate);
    expect(store.supplyTotals()).toEqual({ rations: 12, water: 2 });
  });

  it("writes container contents through updateContainerContents, in whole numbers", async () => {
    const crate = addCrate(wagon, "Ration crate", "rations", [{ name: "Trail Rations", quantity: 10 }]);
    const supply = store.supplyItems().find((s) => s.container)!;
    await store.setSupplyQuantity(supply, 6.6);
    expect(crate.items[0].system.quantity).toBe(7);
    const loose = wagon.createItem({ name: "Loose", system: { quantity: 3 }, flags: { [MODULE_ID]: { supply: "water" } } });
    await store.setSupplyQuantity(store.supplyItems().find((s) => s.item === loose)!, 1);
    expect(loose.system.quantity).toBe(1);
  });

  it("weighs a vehicle's inventory, containers included", () => {
    addCrate(wagon, "Crate", null, [{ name: "Bricks", quantity: 5, weight: 2 }]);
    wagon.createItem({ name: "Barrel", system: { quantity: 2, weight: { total: 60 } } });
    expect(pf1Adapter.inventoryWeight(wagon)).toBe(10 + 10 + 60);
  });
});

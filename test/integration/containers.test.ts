// The Caravan subtype lookup and container-aware supplies: loose supplies drain first, a flagged
// container counts its contents, and undo restores contents through pf1's container API.
import { beforeEach, describe, expect, it } from "vitest";
import { createWorld, useClient, FakeDocument, type FakeActor, type FakeWorld } from "../fakes/foundry";
import { store } from "../../src/store";
import { ledger } from "../../src/ledger";
import { CARAVAN_TYPE, MODULE_ID } from "../../src/types";

let world: FakeWorld & { gm: any; player: any };
let caravan: FakeActor;

/** A pf1-style container: contents in `items`, changed only through updateContainerContents. */
function addCrate(actor: FakeActor, name: string, supply: string | null, contents: { name: string; quantity: number }[]) {
  const crate: any = actor.createItem({
    name,
    type: "container",
    system: { quantity: 1 },
    flags: supply ? { [MODULE_ID]: { supply } } : {},
  });
  crate.items = contents.map((c) => new FakeDocument(world as any, "Item", { name: c.name, system: { quantity: c.quantity } }, crate));
  crate.items.get = (id: string) => crate.items.find((i: any) => i.id === id);
  crate.updateContainerContents = async (updates: any[]) => {
    for (const u of updates) {
      const inner = crate.items.get(u._id);
      if (inner) inner.system.quantity = u["system.quantity"];
    }
  };
  return crate;
}

beforeEach(() => {
  world = createWorld();
  store.registerSettings();
  useClient(world, world.gm);
  world.createScene({ id: "scene1" });
  caravan = world.createActor({ name: "Wagon", type: CARAVAN_TYPE });
});

describe("caravan subtype", () => {
  it("falls back to the first caravan-type actor when none is designated", () => {
    world.createActor({ name: "Not a caravan", type: "npc" });
    expect(store.getCaravanActor()?.uuid).toBe(caravan.uuid);
  });
});

describe("container supplies", () => {
  it("lists loose supplies before container contents and totals both", () => {
    const crate = addCrate(caravan, "Ration crate", "rations", [{ name: "Trail Rations", quantity: 10 }]);
    caravan.createItem({ name: "Loose rations", system: { quantity: 2 }, flags: { [MODULE_ID]: { supply: "rations" } } });
    addCrate(caravan, "Unflagged chest", null, [{ name: "Trail Rations", quantity: 5 }]);

    const supplies = store.supplyItems();
    expect(supplies.map((s) => s.item.name)).toEqual(["Loose rations", "Trail Rations"]);
    expect(supplies[0].container).toBeNull();
    expect(supplies[1].container).toBe(crate);
    expect(store.supplyTotals().rations).toBe(12);
  });

  it("writes container contents through updateContainerContents and undo restores them", async () => {
    const crate = addCrate(caravan, "Ration crate", "rations", [{ name: "Trail Rations", quantity: 10 }]);
    const inner = crate.items[0];
    const supply = store.supplyItems().find((s) => s.container)!;

    const change = await store.setSupplyQuantity(supply, 6.6);
    expect(inner.system.quantity).toBe(7); // whole numbers only: pf1 zeroes non-integers
    expect(change).toMatchObject({ kind: "itemQuantity", before: 10, after: 7, containerUuid: crate.uuid, itemId: inner.id });

    await ledger.record("Drain", [change]);
    await ledger.undoLast();
    expect(inner.system.quantity).toBe(10);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld, useClient, type FakeActor, type FakeScene } from "../fakes/foundry";
import type { CaravanState, Change } from "../../src/types";

vi.mock("../../src/engine", () => ({ engine: { DEFAULT_ROLES: [], DEFAULT_SETTINGS: {} } }));
vi.mock("../../src/pf1", () => ({
  pf1Adapter: { setCondition: (actor: any, id: string, on: boolean) => actor.setCondition(id, on) },
}));

import { store } from "../../src/store";
import { ledger } from "../../src/ledger";

describe("ledger", () => {
  let world: ReturnType<typeof createWorld>;
  let caravan: FakeActor;
  let scene: FakeScene;

  beforeEach(async () => {
    world = createWorld();
    store.registerSettings();
    scene = world.createScene();
    caravan = world.createActor({ name: "Caravan" });
    await store.setCaravanActor(caravan.uuid);
  });

  it("records a multi-part change and undoLast restores everything exactly", async () => {
    const rations = caravan.createItem({ name: "Rations", system: { quantity: 10 } });
    const hero = world.createActor({ name: "Hero" });
    const token = scene.createToken({ x: 100, y: 200 });
    await store.setKnowledge(scene.id, ["0,1"], "explored");
    const before = store.getCaravan();
    const after: CaravanState = { ...before, journeyDay: 1, position: "0,2", wagon: { condition: 10, max: 11 } };
    const timeBefore = game.time.worldTime;

    await rations.update({ "system.quantity": 7 });
    await store.setCaravan(after);
    await store.setKnowledge(scene.id, ["0,2"], "explored");
    await store.setKnowledge(scene.id, ["0,1"], "mapped");
    await game.time.advance(86_400);
    await hero.setCondition("fatigued", true);
    await token.update({ x: 150, y: 250 });

    const changes: Change[] = [
      { kind: "itemQuantity", itemUuid: rations.uuid, before: 10, after: 7 },
      { kind: "caravan", before, after },
      { kind: "knowledge", sceneId: scene.id, key: "0,2", before: "unknown", after: "explored" },
      { kind: "knowledge", sceneId: scene.id, key: "0,1", before: "explored", after: "mapped" },
      { kind: "worldTime", seconds: 86_400 },
      { kind: "condition", actorUuid: hero.uuid, condition: "fatigued", before: false, after: true },
      { kind: "token", tokenUuid: token.uuid, before: { x: 100, y: 200 }, after: { x: 150, y: 250 } },
    ];
    const entry = await ledger.record("Day 1", changes);
    expect(ledger.entries()).toEqual([entry]);

    expect(await ledger.undoLast()).toEqual(entry);
    expect(rations.system.quantity).toBe(10);
    expect(store.getCaravan()).toEqual(before);
    expect(store.getPartyMap(scene.id).knowledge).toEqual({ "0,1": "explored" });
    expect(game.time.worldTime).toBe(timeBefore);
    expect(hero.statuses.has("fatigued")).toBe(false);
    expect({ x: token.x, y: token.y }).toEqual({ x: 100, y: 200 });
    expect(ledger.entries()).toEqual([]);
    expect(await ledger.undoLast()).toBeNull();
  });

  it("undoes the newest entry first and caps the log at 100", async () => {
    for (let i = 0; i < 105; i++) await ledger.record(`Day ${i}`, [{ kind: "worldTime", seconds: 1 }]);
    expect(ledger.entries()).toHaveLength(100);
    expect(ledger.entries()[0].label).toBe("Day 5");
    expect((await ledger.undoLast())!.label).toBe("Day 104");
    expect(ledger.entries().at(-1)!.label).toBe("Day 103");
  });

  it("is GM only", async () => {
    useClient(world, world.player);
    await expect(ledger.record("x", [])).rejects.toThrow("GM only");
    await expect(ledger.undoLast()).rejects.toThrow("GM only");
    expect(ledger.entries()).toEqual([]);
  });
});

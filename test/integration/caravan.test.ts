// hx.caravan: placement and roster edits return typed results, write one ledger entry each, and undo cleanly.
import { beforeEach, describe, expect, it } from "vitest";
import { createWorld, useClient, type FakeActor, type FakeScene, type FakeWorld } from "../fakes/foundry";
import { caravan } from "../../src/caravan";
import { ledger } from "../../src/ledger";
import { store } from "../../src/store";
import { travel } from "../../src/travel";
import { CARAVAN_TYPE, type CaravanResult } from "../../src/types";

let world: FakeWorld & { gm: any; player: any };
let wagon: FakeActor;
let scene: FakeScene;

const ok = (r: CaravanResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.error}`);
  return r;
};
const tokensOf = () => scene.tokens.filter((t: any) => t.actorId === wagon.id);

beforeEach(async () => {
  world = createWorld();
  store.registerSettings();
  useClient(world, world.gm);
  scene = world.createScene({ id: "scene1", name: "Stormlands" });
  wagon = world.createActor({ name: "Wagon", type: CARAVAN_TYPE });
  await store.setCaravanActor(wagon.uuid);
});

describe("placement", () => {
  it("place, move, place again: one token, and position follows it", async () => {
    const first = ok(await caravan.place("7,8"));
    expect(tokensOf()).toHaveLength(1);
    expect(first.caravan).toMatchObject({ position: "7,8", sceneId: "scene1" });
    expect(tokensOf()[0]).toMatchObject({ x: 800, y: 700, actorLink: true }); // centre (850, 750) minus half a cell

    ok(await caravan.place("7,9"));
    ok(await caravan.place("3,4"));
    expect(tokensOf()).toHaveLength(1);
    expect(tokensOf()[0]).toMatchObject({ x: 400, y: 300 });
    expect(caravan.get().position).toBe("3,4");
  });

  it("returns the ledger id of its entry, and undo walks back each placement", async () => {
    const placed = ok(await caravan.place("7,8"));
    expect(placed.ledgerId).toBe(ledger.entries().at(-1)!.id);
    expect(ledger.entries().at(-1)!.label).toBe("Place caravan");
    ok(await caravan.place("7,9"));

    await ledger.undoLast();
    expect(tokensOf()[0]).toMatchObject({ x: 800, y: 700 });
    expect(caravan.get().position).toBe("7,8");
    await ledger.undoLast();
    expect(tokensOf()).toHaveLength(0); // undoing the first placement removes the token it created
    expect(caravan.get().position).toBeNull();
  });

  it("unplace removes the token and clears the position; undo puts it back", async () => {
    ok(await caravan.place("7,8"));
    const removed = ok(await caravan.unplace());
    expect(tokensOf()).toHaveLength(0);
    expect(removed.caravan).toMatchObject({ position: null, sceneId: null });
    await ledger.undoLast();
    expect(tokensOf()).toHaveLength(1);
    expect(caravan.get().position).toBe("7,8");
  });

  it("refuses mid-leg, off the grid, on a non-hex scene and for bad keys", async () => {
    expect(await caravan.place("99,99")).toMatchObject({ ok: false, code: "off-grid" });
    expect(await caravan.place("7")).toMatchObject({ ok: false, code: "bad-value" });
    world.grid.isHexagonal = false;
    expect(await caravan.place("7,8")).toMatchObject({ ok: false, code: "not-hex-scene" });
    world.grid.isHexagonal = true;

    ok(await caravan.place("7,8"));
    await travel.startLeg({ routeId: null, from: "7,8", path: ["7,9"], baseDays: 1, difficulty: "easy", encounterBonus: 0, effects: [], prompts: [], regionId: null });
    expect(await caravan.place("7,9")).toMatchObject({ ok: false, code: "leg-active" });
    expect(await caravan.unplace()).toMatchObject({ ok: false, code: "leg-active" });
  });
});

describe("roster", () => {
  it("adding the same actor twice is refused and leaves the roster unchanged", async () => {
    const camel = world.createActor({ name: "Atan", type: "npc" });
    ok(await caravan.add(camel.uuid, { draft: true }));
    const before = caravan.get().roster;
    expect(await caravan.add(camel.uuid)).toMatchObject({ ok: false, code: "duplicate" });
    expect(caravan.get().roster).toEqual(before);
    expect(before[0]).toMatchObject({ name: "Atan", draft: true });
  });

  it("refuses unknown actors, caravans, and edits to non-members", async () => {
    expect(await caravan.add("Actor.nope")).toMatchObject({ ok: false, code: "unknown-actor" });
    expect(await caravan.add(world.createActor({ name: "Other wagon", type: CARAVAN_TYPE }).uuid)).toMatchObject({ ok: false, code: "caravan-actor" });
    expect(await caravan.remove("Actor.nope")).toMatchObject({ ok: false, code: "not-member" });
    expect(await caravan.update("Actor.nope", { draft: true })).toMatchObject({ ok: false, code: "not-member" });
  });

  it("removing a role-holder mid-leg is refused and the error names the role", async () => {
    const shemsu = world.createActor({ name: "Shemsu-Ra", type: "character" });
    ok(await caravan.add(shemsu.uuid));
    ok(await caravan.place("7,8"));
    await travel.startLeg({ routeId: null, from: "7,8", path: ["7,9"], baseDays: 1, difficulty: "easy", encounterBonus: 0, effects: [], prompts: [], regionId: null });
    const legged = structuredClone(store.getCaravan());
    legged.leg!.assignments.push({ roleId: "navigator", actorUuid: shemsu.uuid });
    await store.setCaravan(legged);

    const refused = await caravan.remove(shemsu.uuid);
    expect(refused).toMatchObject({ ok: false, code: "holds-role" });
    expect(!refused.ok && refused.error).toContain("Navigator");
    expect(caravan.member(shemsu.uuid)).not.toBeNull();
  });

  it("add three people, then undo three times: the roster is back where it started", async () => {
    const names = ["Ayla", "Bren", "Cass"];
    for (const name of names) ok(await caravan.add(world.createActor({ name, type: "npc" }).uuid));
    expect(caravan.get().roster.map((m) => m.name)).toEqual(names);
    expect(ledger.entries().slice(-3).map((e) => e.label)).toEqual(names.map((n) => `Add to roster: ${n}`));
    for (let n = 0; n < 3; n++) await ledger.undoLast();
    expect(caravan.get().roster).toEqual([]);
  });

  it("updates one member, validates values, and finds members by name", async () => {
    const pc = world.createActor({ name: "Zuleia Veresendi", type: "character" });
    ok(await caravan.add(pc.uuid, { npc: false }));
    expect(caravan.member(pc.uuid)!.npc).toBe(false);
    const updated = ok(await caravan.update(pc.uuid, { food: 2, water: 1.5, draft: true }));
    expect(updated.caravan.roster[0]).toMatchObject({ food: 2, water: 1.5, draft: true });
    expect(await caravan.update(pc.uuid, { food: -1 })).toMatchObject({ ok: false, code: "bad-value" });
    expect(await caravan.setDraftRequired(1.5)).toMatchObject({ ok: false, code: "bad-value" });
    expect(ok(await caravan.setDraftRequired(2)).caravan.draftRequired).toBe(2);
    expect(caravan.findMember("  zuleia veresendi ")?.actorUuid).toBe(pc.uuid);
    expect(caravan.findMember("Zuleia")).toBeNull();
    ok(await caravan.remove(pc.uuid));
    expect(ledger.entries().at(-1)!.label).toBe("Remove from roster: Zuleia Veresendi");
  });
});

describe("shared refusals", () => {
  it("players get gm-only; no caravan gives no-caravan-actor", async () => {
    const pc = world.createActor({ name: "Sabrina", type: "character" });
    useClient(world, world.player);
    expect(await caravan.add(pc.uuid)).toEqual({ ok: false, code: "gm-only", error: "Only the GM can change the caravan." });
    expect(await caravan.place("7,8")).toMatchObject({ ok: false, code: "gm-only" });
    useClient(world, world.gm);

    await store.setCaravanActor(null);
    wagon.type = "npc"; // no caravan-type actor left to fall back to
    expect(await caravan.add(pc.uuid)).toMatchObject({ ok: false, code: "no-caravan-actor" });
  });
});

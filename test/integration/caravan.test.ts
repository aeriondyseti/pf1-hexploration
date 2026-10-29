// hx.caravan on the MVP model: placement, travellers and vehicles, seats/drivers/teams, sticky roles and party
// funds. Players' edits go through the authority to the GM's client, which checks ownership.
import { beforeEach, describe, expect, it } from "vitest";
import { createWorld, useClient, type FakeActor, type FakeScene, type FakeWorld } from "../fakes/foundry";
import { authority } from "../../src/authority";
import { caravan } from "../../src/caravan";
import { store } from "../../src/store";
import { CARAVAN_TYPE, type CaravanResult } from "../../src/types";

let world: FakeWorld & { gm: any; player: any };
let caravanActor: FakeActor;
let scene: FakeScene;
let wagon: FakeActor;
let pc: FakeActor; // owned by the player
let horse: FakeActor; // owned by the player
let npc: FakeActor; // GM's

const ok = (r: CaravanResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.error}`);
  return r;
};
const tokensOf = () => scene.tokens.filter((t: any) => t.actorId === caravanActor.id);
const asPlayer = () => useClient(world, world.player);
const asGM = () => useClient(world, world.gm);

beforeEach(async () => {
  world = createWorld();
  store.registerSettings();
  for (const client of [world.gm, world.player]) {
    useClient(world, client);
    authority.init();
  }
  asGM();
  caravan.init();
  scene = world.createScene({ id: "scene1", name: "Stormlands" });
  caravanActor = world.createActor({ name: "The Company", type: CARAVAN_TYPE });
  await store.setCaravanActor(caravanActor.uuid);
  const playerId = world.player.user.id;
  wagon = world.createActor({ name: "Covered Wagon", type: "vehicle", system: { attributes: { hp: { value: 20, max: 40 } } } });
  pc = world.createActor({ name: "Mira", type: "character", owners: [playerId], system: { currency: { pp: 0, gp: 10, sp: 3, cp: 0 } } });
  horse = world.createActor({ name: "Draft Horse", type: "npc", owners: [playerId], system: { traits: { size: "lg" } } });
  npc = world.createActor({ name: "Bram", type: "npc", system: { skills: { han: { mod: 5 } } } });
});

describe("placement", () => {
  it("place, move, unplace: one token and the position follows it", async () => {
    expect(ok(await caravan.place("7,8")).caravan).toMatchObject({ position: "7,8", sceneId: "scene1" });
    expect(tokensOf()).toHaveLength(1);
    expect(tokensOf()[0]).toMatchObject({ x: 800, y: 700, actorLink: true });
    ok(await caravan.place("3,4"));
    expect(tokensOf()).toHaveLength(1);
    expect(tokensOf()[0]).toMatchObject({ x: 400, y: 300 });
    expect(ok(await caravan.unplace()).caravan).toMatchObject({ position: null, sceneId: null });
    expect(tokensOf()).toHaveLength(0);
  });

  it("refuses off the grid, bad keys, during a trip and on a player's client", async () => {
    expect(await caravan.place("99,99")).toMatchObject({ ok: false, code: "off-grid" });
    expect(await caravan.place("7")).toMatchObject({ ok: false, code: "bad-value" });
    const c = store.getCaravan();
    c.trip = { activity: "travel", course: [], day: 0, exploreDays: 0 };
    await store.setCaravan(c);
    expect(await caravan.place("7,8")).toMatchObject({ ok: false, code: "trip-active" });
    asPlayer();
    expect(await caravan.place("7,8")).toMatchObject({ ok: false, code: "gm-only" });
  });
});

describe("adding and removing", () => {
  it("links a pf1 vehicle and three actors, with vehicle defaults by name", async () => {
    ok(await caravan.add(wagon.uuid));
    for (const a of [pc, horse, npc]) ok(await caravan.add(a.uuid));
    const c = caravan.get();
    expect(c.vehicles).toEqual([
      { actorUuid: wagon.uuid, name: "Covered Wagon", driver: null, team: [], teamRequired: 2, seats: 4, cargoCapacity: 2000, milesPerDay: 16 },
    ]);
    expect(c.travellers.map((t) => t.name)).toEqual(["Mira", "Draft Horse", "Bram"]);
    expect(caravan.traveller(horse.uuid)).toMatchObject({ food: 2, water: 2, wage: 0, seat: null });
    expect(await caravan.add(pc.uuid)).toMatchObject({ ok: false, code: "duplicate" });
    expect(await caravan.add(world.createActor({ name: "Other", type: CARAVAN_TYPE }).uuid)).toMatchObject({ ok: false, code: "caravan-actor" });
    expect(await caravan.add("Actor.nope")).toMatchObject({ ok: false, code: "unknown-actor" });
  });

  it("a player adds only actors they own, and the GM is whispered", async () => {
    asPlayer();
    ok(await caravan.add(pc.uuid));
    expect(await caravan.add(npc.uuid)).toMatchObject({ ok: false });
    expect(caravan.get().travellers.map((t) => t.name)).toEqual(["Mira"]);
    const gmId = world.gm.user.id;
    expect(world.messages.at(-1)).toMatchObject({ whisper: [gmId] });
    expect(world.messages.at(-1).content).toContain("Mira");
  });

  it("removing a traveller clears their seat, driving, team and roles; removing a vehicle clears its seats", async () => {
    for (const a of [wagon, pc, horse, npc]) ok(await caravan.add(a.uuid));
    ok(await caravan.setDriver(wagon.uuid, npc.uuid));
    ok(await caravan.setTeam(wagon.uuid, horse.uuid, true));
    ok(await caravan.setSeat(pc.uuid, wagon.uuid));
    ok(await caravan.setRole("scout", npc.uuid));
    ok(await caravan.remove(npc.uuid));
    let c = caravan.get();
    expect(c.vehicles[0].driver).toBeNull();
    expect(c.roles.scout).toBeNull();
    ok(await caravan.remove(horse.uuid));
    expect(caravan.get().vehicles[0].team).toEqual([]);
    ok(await caravan.remove(wagon.uuid));
    c = caravan.get();
    expect(c.vehicles).toEqual([]);
    expect(caravan.traveller(pc.uuid)!.seat).toBeNull();
    expect(await caravan.remove(npc.uuid)).toMatchObject({ ok: false, code: "not-member" });
  });
});

describe("seats, drivers and teams", () => {
  beforeEach(async () => {
    for (const a of [wagon, pc, horse, npc]) ok(await caravan.add(a.uuid));
  });

  it("a player seats their PC and teams their horse, but not an actor they don't own", async () => {
    asPlayer();
    ok(await caravan.setSeat(pc.uuid, wagon.uuid));
    ok(await caravan.setTeam(wagon.uuid, horse.uuid, true));
    expect(await caravan.setSeat(npc.uuid, wagon.uuid)).toMatchObject({ ok: false });
    expect(await caravan.setTeam(wagon.uuid, npc.uuid, true)).toMatchObject({ ok: false });
    expect(await caravan.setDriver(wagon.uuid, npc.uuid)).toMatchObject({ ok: false });
    const c = caravan.get();
    expect(caravan.traveller(pc.uuid)!.seat).toBe(wagon.uuid);
    expect(c.vehicles[0].team).toEqual([horse.uuid]);
    expect(c.vehicles[0].driver).toBeNull();
    expect(caravan.traveller(npc.uuid)!.seat).toBeNull();
  });

  it("a player can't take or clear a driver slot held by someone else's actor", async () => {
    ok(await caravan.setDriver(wagon.uuid, npc.uuid));
    asPlayer();
    expect(await caravan.setDriver(wagon.uuid, pc.uuid)).toMatchObject({ ok: false });
    expect(await caravan.setDriver(wagon.uuid, null)).toMatchObject({ ok: false });
    expect(caravan.get().vehicles[0].driver).toBe(npc.uuid);
  });

  it("an actor is in at most one of a seat, a driver slot and a team", async () => {
    ok(await caravan.setSeat(pc.uuid, wagon.uuid));
    ok(await caravan.setDriver(wagon.uuid, pc.uuid));
    expect(caravan.traveller(pc.uuid)!.seat).toBeNull();
    ok(await caravan.setTeam(wagon.uuid, pc.uuid, true));
    expect(caravan.get().vehicles[0]).toMatchObject({ driver: null, team: [pc.uuid] });
    ok(await caravan.setSeat(pc.uuid, wagon.uuid));
    expect(caravan.get().vehicles[0].team).toEqual([]);
    expect(await caravan.setSeat(pc.uuid, "Actor.nope")).toMatchObject({ ok: false, code: "not-vehicle" });
  });
});

describe("roles", () => {
  beforeEach(async () => {
    for (const a of [wagon, pc, horse, npc]) ok(await caravan.add(a.uuid));
  });

  it("are sticky, at most two per actor counting driving", async () => {
    ok(await caravan.setRole("navigator", npc.uuid));
    ok(await caravan.setDriver(wagon.uuid, npc.uuid));
    expect(await caravan.setRole("scout", npc.uuid)).toMatchObject({ ok: false, code: "too-many-roles" });
    ok(await caravan.setRole("navigator", npc.uuid)); // re-setting a held role is fine
    ok(await caravan.setDriver(wagon.uuid, null));
    ok(await caravan.setRole("scout", npc.uuid));
    expect(await caravan.setDriver(wagon.uuid, npc.uuid)).toMatchObject({ ok: false, code: "too-many-roles" });
    expect(caravan.get().roles).toMatchObject({ navigator: npc.uuid, scout: npc.uuid });
  });

  it("a player sets roles for their own actor, never over someone else's holder", async () => {
    ok(await caravan.setRole("scout", npc.uuid));
    asPlayer();
    ok(await caravan.setRole("navigator", pc.uuid));
    expect(await caravan.setRole("scout", pc.uuid)).toMatchObject({ ok: false });
    expect(await caravan.setRole("forager", npc.uuid)).toMatchObject({ ok: false });
    ok(await caravan.setRole("navigator", null)); // releasing their own
    expect(caravan.get().roles).toMatchObject({ scout: npc.uuid, navigator: null });
  });
});

describe("party funds", () => {
  it("a player deposits 5 gp and withdraws it; the GM is whispered each time", async () => {
    asPlayer();
    const before = world.messages.length;
    expect(ok(await caravan.deposit(pc.uuid, { pp: 0, gp: 5, sp: 0, cp: 0 })).caravan.funds).toBe(500);
    expect(pc.system.currency).toMatchObject({ gp: 5, sp: 3 });
    expect(ok(await caravan.withdraw(pc.uuid, { pp: 0, gp: 5, sp: 0, cp: 0 })).caravan.funds).toBe(0);
    expect(pc.system.currency).toMatchObject({ gp: 10 });
    expect(world.messages.length).toBe(before + 2);
    expect(world.messages.slice(-2).every((m) => m.whisper?.includes(world.gm.user.id))).toBe(true);
  });

  it("refuses coins the character lacks, overdrawing the funds, and someone else's character", async () => {
    expect(await caravan.deposit(pc.uuid, { pp: 1, gp: 0, sp: 0, cp: 0 })).toMatchObject({ ok: false, code: "insufficient-funds" });
    expect(await caravan.withdraw(pc.uuid, { pp: 0, gp: 1, sp: 0, cp: 0 })).toMatchObject({ ok: false, code: "insufficient-funds" });
    expect(await caravan.deposit(pc.uuid, { pp: 0, gp: -1, sp: 0, cp: 0 })).toMatchObject({ ok: false, code: "bad-value" });
    asPlayer();
    expect(await caravan.deposit(npc.uuid, { pp: 0, gp: 1, sp: 0, cp: 0 })).toMatchObject({ ok: false });
    expect(pc.system.currency.gp).toBe(10);
    expect(caravan.get().funds).toBe(0);
  });
});

describe("GM numbers", () => {
  it("updates a traveller's wage and a vehicle's numbers, validating values", async () => {
    for (const a of [wagon, npc]) ok(await caravan.add(a.uuid));
    expect(ok(await caravan.updateTraveller(npc.uuid, { wage: 30 })).caravan.travellers[0].wage).toBe(30);
    expect(await caravan.updateTraveller(npc.uuid, { food: -1 })).toMatchObject({ ok: false, code: "bad-value" });
    expect(ok(await caravan.updateVehicle(wagon.uuid, { seats: 6 })).caravan.vehicles[0].seats).toBe(6);
    asPlayer();
    expect(await caravan.updateTraveller(npc.uuid, { wage: 0 })).toMatchObject({ ok: false, code: "gm-only" });
  });
});

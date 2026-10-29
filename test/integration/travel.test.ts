// The trip flow (DESIGN §4.10, §4.13): a player's plan, GM approval, auto-rolled days, the summary card,
// supplies drained from the vehicle, world time, Travel all, and undo of the last day.
import { beforeEach, describe, expect, it } from "vitest";
import { createWorld, useClient, type FakeActor, type FakeWorld } from "../fakes/foundry";
import { authority } from "../../src/authority";
import { caravan } from "../../src/caravan";
import { store } from "../../src/store";
import { travel } from "../../src/travel";
import { CARAVAN_TYPE, MODULE_ID, type MapData } from "../../src/types";

let world: FakeWorld & { gm: any; player: any };
let wagon: FakeActor;
let pc: FakeActor;
let horse: FakeActor;
let rations: any;

const asPlayer = () => useClient(world, world.player);
const asGM = () => useClient(world, world.gm);

function plainsMap(): MapData {
  const hexes: MapData["hexes"] = {};
  for (let j = 4; j <= 9; j++) hexes[`5,${j}`] = { key: `5,${j}`, terrain: "plains", region: null, tags: [] };
  return { version: 2, hexes, regions: {}, landmarks: {}, routes: {} };
}

beforeEach(async () => {
  world = createWorld();
  store.registerSettings();
  for (const client of [world.gm, world.player]) {
    useClient(world, client);
    authority.init();
  }
  asGM();
  caravan.init();
  travel.init();
  world.createScene({ id: "scene1", name: "Plains" });
  const actor = world.createActor({ name: "The Company", type: CARAVAN_TYPE });
  await store.setCaravanActor(actor.uuid);
  await store.setMap(plainsMap(), "scene1");
  const playerId = world.player.user.id;
  wagon = world.createActor({ name: "Cart", type: "vehicle", system: { attributes: { hp: { value: 30, max: 30 } } } });
  pc = world.createActor({ name: "Mira", type: "character", owners: [playerId], skillTotal: 30 });
  horse = world.createActor({ name: "Horse", type: "npc", system: { traits: { size: "lg" } } });
  rations = wagon.createItem({ name: "Rations", system: { quantity: 10 }, flags: { [MODULE_ID]: { supply: "rations" } } });
  wagon.createItem({ name: "Water", system: { quantity: 10 }, flags: { [MODULE_ID]: { supply: "water" } } });
  for (const a of [wagon, pc, horse]) expect((await caravan.add(a.uuid)).ok).toBe(true);
  await caravan.setDriver(wagon.uuid, pc.uuid);
  await caravan.setTeam(wagon.uuid, horse.uuid, true);
  await caravan.setRole("navigator", pc.uuid);
  await caravan.place("5,4", "scene1");
});

describe("trip flow", () => {
  it("a player's course waits for the GM; Next Day rolls, moves, drains, posts one card; Undo restores it", async () => {
    asPlayer();
    expect(await travel.setPlan({ activity: "travel", course: ["5,5", "5,6"], routeId: null }, "set the destination")).toEqual({ ok: true });
    await travel.approve(); // players can't approve
    expect(store.getCaravan().trip).toBeNull();
    expect(store.getCaravan().plan).toMatchObject({ course: ["5,5", "5,6"], lastEdit: { text: "set the destination" } });

    asGM();
    await travel.approve();
    expect(store.getCaravan().trip).toMatchObject({ activity: "travel", course: ["5,5", "5,6"], day: 0 });
    const cards = world.messages.length;
    const out = await travel.nextDay();
    expect(out).not.toBeNull();
    const c = store.getCaravan();
    expect(c.position).toBe("5,5");
    expect(c.journeyDay).toBe(1);
    expect(c.trip?.course).toEqual(["5,6"]);
    expect(Number(rations.system.quantity)).toBe(7); // Mira eats 1, the Large horse 2
    expect(world.worldTime).toBe(86400);
    const publicCards = world.messages.slice(cards).filter((m: any) => !m.whisper?.length);
    expect(publicCards).toHaveLength(1); // the day's summary card
    // Drivers roll with no dialog and no pf1 card.
    expect(pc.skillCalls.at(-1)?.options).toMatchObject({ skipDialog: true, chatMessage: false });

    await travel.undo();
    expect(store.getCaravan()).toMatchObject({ position: "5,4", journeyDay: 0, trip: { day: 0 } });
    expect(Number(rations.system.quantity)).toBe(10);
    expect(world.worldTime).toBe(0);
  });

  it("Travel all runs to the destination and ends the trip", async () => {
    await travel.setPlan({ activity: "travel", course: ["5,5", "5,6", "5,7"], routeId: null }, "plotted");
    await travel.approve();
    await travel.travelAll();
    expect(store.getCaravan()).toMatchObject({ position: "5,7", trip: null, journeyDay: 3 });
  });

  it("refuses a course that isn't a chain of adjacent hexes", async () => {
    asPlayer();
    const res = await travel.setPlan({ activity: "travel", course: ["5,7"], routeId: null }, "teleport");
    expect(res.ok).toBe(false);
  });
});

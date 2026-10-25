import { beforeEach, describe, expect, it } from "vitest";
import { createWorld, useClient, type FakeActor, type FakeWorld } from "../fakes/foundry";
import { authority } from "../../src/authority";
import { engine } from "../../src/engine";
import { ledger } from "../../src/ledger";
import { pf1Adapter } from "../../src/pf1";
import { store } from "../../src/store";
import { pendingProposal, sendPathProposal, settleProposal, travel } from "../../src/travel";
import { MODULE_ID, type MapData } from "../../src/types";

const map: MapData = {
  hexes: Object.fromEntries(
    ["0,0", "0,1", "0,2", "0,3"].map((key) => [key, { key, terrain: "desert", difficulty: "standard", region: null, tags: [] }]),
  ),
  regions: {},
  landmarks: {},
  routes: {
    dunes: {
      id: "dunes",
      name: "The Long Dunes",
      hexes: ["0,1", "0,2", "0,3"],
      from: "0,0",
      days: 3,
      difficulty: "standard",
      encounterBonus: 2,
      bargain: "Three hard days, no water.",
      effects: [],
      prompts: [],
      knownToParty: true,
    },
  },
};

// Role -> [roster index, role-roll total]. Forager, Wainwright and Healer fail.
const ASSIGN: Record<string, [number, number]> = {
  navigator: [0, 30],
  scout: [1, 30],
  forager: [2, 1],
  driver: [3, 30],
  wainwright: [4, 1],
  cartographer: [5, 30],
  healer: [6, 1],
};
const PLAYER_OWNED = [0, 1, 2, 3];

let world: FakeWorld & { gm: any; player: any };
let roster: FakeActor[];
let rations: any;
let water: any;
let token: any;

function makeActor(index: number, name: string, opts: { size?: string; fort?: number[]; type?: string } = {}) {
  return world.createActor({
    name,
    system: { traits: { size: opts.size ?? "med" }, skills: { sur: { mod: 5 }, hea: { mod: 1 } } },
    race: opts.type ? { system: { creatureTypes: [opts.type] } } : undefined,
    owners: PLAYER_OWNED.includes(index) ? [world.player.user.id] : [],
    skillTotal: Object.values(ASSIGN).find(([i]) => i === index)![1],
    fortTotals: opts.fort ?? [20],
  });
}

function snapshot() {
  return {
    caravan: store.getCaravan(),
    rations: rations.system.quantity,
    water: water.system.quantity,
    statuses: roster.map((a) => [...a.statuses].sort()),
    token: { x: token.x, y: token.y },
    worldTime: world.worldTime,
    knowledge: store.getPartyMap("scene1").knowledge,
    ledger: ledger.entries().length,
  };
}

beforeEach(async () => {
  world = createWorld();
  store.registerSettings();
  authority.init();
  travel.init();
  useClient(world, world.player);
  authority.init();
  useClient(world, world.gm);

  world.createScene({ id: "scene1" });
  const caravanActor = world.createActor({ name: "Caravan" });
  rations = caravanActor.createItem({ name: "Rations", system: { quantity: 40 }, flags: { [MODULE_ID]: { supply: "rations" } } });
  water = caravanActor.createItem({ name: "Water", system: { quantity: 60 }, flags: { [MODULE_ID]: { supply: "water" } } });
  token = world.activeScene!.createToken({ actorId: caravanActor.id, width: 1, height: 1, x: 0, y: 0 });
  await store.setCaravanActor(caravanActor.uuid);
  await store.setMap(map, "scene1");

  roster = [
    makeActor(0, "Ayla"),
    makeActor(1, "Bren"),
    makeActor(2, "Cass"),
    makeActor(3, "Dov"),
    makeActor(4, "Brass Porter", { type: "construct" }), // neither eats nor marches
    makeActor(5, "Fen (NPC)", { fort: [1] }), // always fails
    makeActor(6, "Camel", { size: "lg", fort: [11] }), // passes DC 10 only
  ];
  const caravan = store.getCaravan();
  caravan.roster = roster.map((a, i) => pf1Adapter.rosterMemberFor(a, i === 6));
  await store.setCaravan(caravan);
});

describe("pf1 adapter", () => {
  it("builds roster members from size and ownership", () => {
    const members = store.getCaravan().roster;
    expect(members[0]).toMatchObject({ food: 1, water: 1, npc: false, draft: false });
    expect(members[4]).toMatchObject({ food: 0, water: 0, npc: true });
    expect(members[6]).toMatchObject({ food: 2, water: 2, npc: true, draft: true });
    expect(engine.consumption(members)).toEqual({ food: 7, water: 7 });
    const skel = { system: { traits: { size: { value: "sm" } } }, race: { system: { creatureTypes: ["undead"] } } };
    expect(pf1Adapter.sizeMultiplier(skel)).toBe(0.5);
    expect(pf1Adapter.consumptionFor(skel)).toEqual({ food: 0, water: 0 });
    // The prepared pf1 v11 shape: value is an index into the size chart.
    expect(pf1Adapter.sizeMultiplier({ system: { traits: { size: { base: "lg", value: 5 } } } })).toBe(2);
    expect(pf1Adapter.sizeMultiplier({ system: { traits: { size: { base: "sm", value: 3 } } } })).toBe(0.5);
    expect(pf1Adapter.sizeMultiplier({ system: { traits: { size: { base: "huge" } } } })).toBe(5);
    const golem = { system: { traits: { size: "med", creatureTypes: { standard: new Set(["construct"]) } } } };
    expect(pf1Adapter.consumptionFor(golem)).toEqual({ food: 0, water: 0 });
  });

  it("picks the best allowed skill, including subskills", () => {
    const actor = { system: { skills: { sur: { mod: 3 }, pro: { mod: 0, subSkills: { pro1: { mod: 9 } } } } } };
    expect(pf1Adapter.bestSkill(actor, ["sur", "pro"])).toBe("pro.pro1");
    expect(pf1Adapter.bestSkill(actor, ["sur", "per"])).toBe("sur");
  });
});

describe("travel leg", () => {
  it("turns a player's claim on a held role into a GM request; the GM can reassign", async () => {
    await travel.startLeg(engine.planFromRoute(store.getMap("scene1"), "dunes"));
    expect(await authority.send({ type: "claimRole", roleId: "scout", actorUuid: roster[0].uuid })).toEqual({ ok: true });
    useClient(world, world.player);
    const result = await authority.send({ type: "claimRole", roleId: "scout", actorUuid: roster[1].uuid });
    expect(result).toEqual({ ok: false, error: "Role is held; the GM has been asked" });
    useClient(world, world.gm);
    expect(world.messages.at(-1).content).toContain("asks to take");
    expect(world.messages.at(-1).whisper).toEqual([world.gm.user.id]);
    expect(await authority.send({ type: "claimRole", roleId: "scout", actorUuid: roster[1].uuid })).toEqual({ ok: true });
    expect(store.getCaravan().leg!.assignments).toEqual([{ roleId: "scout", actorUuid: roster[1].uuid }]);
    useClient(world, world.player);
    // A player cannot claim for an actor they don't own.
    const npc = await authority.send({ type: "claimRole", roleId: "healer", actorUuid: roster[5].uuid });
    expect(npc.ok).toBe(false);
    useClient(world, world.gm);
  });

  it("runs a three-day forced march and undoes it exactly", async () => {
    await travel.startLeg(engine.planFromRoute(store.getMap("scene1"), "dunes"));
    expect(world.messages.at(-1).content).toContain("The Long Dunes");

    // Players claim and roll their own actors through the authority channel; the GM handles the NPCs.
    for (const [roleId, [idx]] of Object.entries(ASSIGN)) {
      useClient(world, PLAYER_OWNED.includes(idx) ? world.player : world.gm);
      expect(await authority.send({ type: "claimRole", roleId, actorUuid: roster[idx].uuid })).toEqual({ ok: true });
      await travel.rollRole(roleId, roster[idx].uuid);
      await world.flush();
    }
    useClient(world, world.gm);
    const leg = store.getCaravan().leg!;
    expect(leg.assignments).toHaveLength(7);
    expect(leg.rolls.map((r) => r.total).sort()).toEqual([1, 1, 1, 30, 30, 30, 30]);
    // The player's rolls were made on the player's own client.
    expect(roster[0].skillCalls).toHaveLength(1);

    await travel.resolveMuster();
    const outcome = store.getCaravan().leg!.outcome!;
    expect(outcome.totalDays).toBe(3);
    expect(outcome.roles.find((r) => r.roleId === "healer")!.success).toBe(false);
    expect(outcome.days.map((d) => d.forcedMarchDc)).toEqual([10, 12, 14]);
    // Forager DC 10 + 2 x (6 eaters - 1): the construct doesn't eat.
    expect(Object.fromEntries(outcome.roles.map((r) => [r.roleId, r.dc]))).toEqual({
      navigator: 18, scout: 18, forager: 20, driver: 15, wainwright: 15, cartographer: 15, healer: 18,
    });
    // Seven members, the construct neither eats nor drinks, the Large camel counts double.
    expect(outcome.days.every((d) => d.drain.rations === 7 && d.drain.water === 7)).toBe(true);

    const start = snapshot();
    const expectedDrain = outcome.days.reduce(
      (t, d) => ({ rations: t.rations + d.drain.rations, water: t.water + d.drain.water, wagon: t.wagon + d.drain.wagon }),
      { rations: 0, water: 0, wagon: 0 },
    );

    await travel.nextDay();
    expect(store.getCaravan().leg!.saves.filter((s) => s.day === 1).map((s) => [s.dc, s.total])).toEqual([
      [10, null], [10, null], [10, null], [10, null], [10, 1], [10, 11],
    ]);
    expect(roster[4].statuses.size).toBe(0); // the construct is never asked to save
    expect(roster[5].statuses.has("fatigued")).toBe(true);
    await travel.nextDay();
    expect(roster[5].statuses.has("exhausted")).toBe(true);
    expect(roster[6].statuses.has("fatigued")).toBe(true); // 11 vs DC 12
    await travel.nextDay();
    // The leg waits on the last day's saves instead of throwing them away.
    expect(store.getCaravan().leg!.dayIndex).toBe(3);
    await travel.arrive();
    expect(store.getCaravan().leg).not.toBeNull();
    useClient(world, world.player);
    for (const s of store.getCaravan().leg!.saves.filter((x) => x.total === null)) await travel.rollSave(s.actorUuid, s.day);
    await world.flush();
    useClient(world, world.gm);
    expect(store.getCaravan().leg!.saves.every((s) => s.total !== null)).toBe(true);
    await travel.arrive();

    // Player-owned members were prompted each day, at the climbing DC.
    const playerWhispers = world.messages
      .filter((m) => m.whisper?.includes(world.player.user.id) && m.content.includes("Forced march"))
      .map((m) => m.content.match(/DC (\d+)/)[1]);
    expect(playerWhispers).toEqual([...Array(4).fill("10"), ...Array(4).fill("12"), ...Array(4).fill("14")]);

    const end = store.getCaravan();
    expect(end.leg).toBeNull();
    expect(end.journeyDay).toBe(start.caravan.journeyDay + 3);
    expect(end.consecutiveForcedMarch).toBe(3);
    expect(end.position).toBe("0,3");
    expect(end.wagon.condition).toBe(start.caravan.wagon.condition - expectedDrain.wagon);
    expect(rations.system.quantity).toBe(start.rations - expectedDrain.rations);
    expect(water.system.quantity).toBe(start.water - expectedDrain.water);
    expect(world.worldTime).toBe(start.worldTime + 3 * 86400);
    expect({ x: token.x, y: token.y }).toEqual({ x: 300, y: 0 });
    expect(store.getPartyMap("scene1").knowledge).toEqual({ "0,0": "mapped", "0,1": "mapped", "0,2": "mapped", "0,3": "mapped" });
    expect(roster[6].statuses.has("exhausted")).toBe(true);
    expect(world.messages.at(-1).content).toContain("Arrived");

    while (ledger.entries().length > start.ledger) await travel.undo();
    expect(snapshot()).toEqual(start);
  });

  it("drops an actor's rolls when doubling changes their penalty", async () => {
    await travel.startLeg(engine.planFromRoute(store.getMap("scene1"), "dunes"));
    const a = roster[5].uuid;
    await authority.send({ type: "claimRole", roleId: "scout", actorUuid: a });
    await travel.rollRole("scout", a);
    expect(store.getCaravan().leg!.rolls).toHaveLength(1);
    await authority.send({ type: "claimRole", roleId: "driver", actorUuid: a });
    expect(store.getCaravan().leg!.rolls).toHaveLength(0); // must reroll with the penalty
    await travel.rollRole("scout", a);
    expect(roster[5].skillCalls.at(-1)!.options.bonus).toBe("-4[Doubling]");
    await authority.send({ type: "releaseRole", roleId: "driver", actorUuid: a });
    expect(store.getCaravan().leg!.rolls).toHaveLength(0);
  });

  it("travels a wholly Mapped route with no roll, and adds days when short of draft animals", async () => {
    await store.setKnowledge("scene1", ["0,1", "0,2", "0,3"], "mapped");
    const caravan = store.getCaravan();
    caravan.draftRequired = 2; // only the camel pulls
    await store.setCaravan(caravan);
    await travel.startLeg(engine.planFromRoute(store.getMap("scene1"), "dunes"));
    await travel.resolveMuster();
    const outcome = store.getCaravan().leg!.outcome!;
    expect(outcome.roles.every((r) => r.success && r.total === null)).toBe(true);
    expect(outcome.totalDays).toBe(4);
    expect(outcome.days.every((d) => d.forcedMarchDc === null)).toBe(true);
    expect(world.messages.at(-1).content).toContain("no roll was needed");
  });

  it("lets only the Forager's owner pick the preserved track", async () => {
    await travel.startLeg(engine.planFromRoute(store.getMap("scene1"), "dunes"));
    await authority.send({ type: "claimRole", roleId: "forager", actorUuid: roster[5].uuid }); // GM-run NPC
    const leg = store.getCaravan().leg!;
    const caravan = store.getCaravan();
    caravan.leg = { ...leg, rolls: [{ roleId: "forager", actorUuid: roster[5].uuid, total: 30 }] };
    await store.setCaravan(caravan);
    await travel.resolveMuster();
    useClient(world, world.player);
    expect(await authority.send({ type: "preserveChoice", day: 1, track: "rations" })).toEqual({
      ok: false,
      error: "You do not own that actor",
    });
    useClient(world, world.gm);
    expect(await authority.send({ type: "preserveChoice", day: 1, track: "rations" })).toEqual({ ok: true });
  });

  it("does not let running out of food lift Exhausted", async () => {
    roster[0].statuses.add("exhausted");
    rations.system.quantity = 0;
    await travel.startLeg(engine.planFromRoute(store.getMap("scene1"), "dunes"));
    await travel.resolveMuster();
    await travel.nextDay();
    expect([...roster[0].statuses]).toEqual(["exhausted"]);
  });

  it("records a partial day when a step fails, so undo still reverts what landed", async () => {
    await travel.startLeg(engine.planFromRoute(store.getMap("scene1"), "dunes"));
    await travel.resolveMuster();
    const start = { rations: rations.system.quantity, caravan: store.getCaravan() };
    const advance = game.time.advance;
    game.time.advance = async () => {
      throw new Error("clock offline");
    };
    await expect(travel.nextDay()).rejects.toThrow("clock offline");
    game.time.advance = advance;
    expect(rations.system.quantity).toBeLessThan(start.rations);
    expect(ledger.entries().at(-1)!.label).toBe("Day 1 (partial)");
    expect(store.getCaravan()).toEqual(start.caravan); // the day did not advance
    await travel.undo();
    expect(rations.system.quantity).toBe(start.rations);
  });

  it("lets a player propose an off-route path for the GM to approve", async () => {
    useClient(world, world.player);
    expect((await sendPathProposal("0,0", ["0,2"])).ok).toBe(false); // not adjacent
    expect(await sendPathProposal("0,0", ["0,1", "0,2"])).toEqual({ ok: true });
    await world.flush();
    useClient(world, world.gm);
    expect(pendingProposal()).toMatchObject({ userId: world.player.user.id, path: ["0,1", "0,2"] });
    await settleProposal(true);
    expect(pendingProposal()).toBeNull();
    expect(store.getCaravan().leg!.plan).toMatchObject({ routeId: null, from: "0,0", path: ["0,1", "0,2"] });
  });

  it("refuses GM actions from a player", async () => {
    useClient(world, world.player);
    await travel.startLeg(engine.planFromRoute(store.getMap("scene1"), "dunes"));
    expect(world.notifications.warn.length).toBeGreaterThan(0);
    useClient(world, world.gm);
    expect(store.getCaravan().leg).toBeNull();
  });
});

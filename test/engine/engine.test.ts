import { describe, expect, it } from "vitest";
import { engine } from "../../src/engine";
import type { ResolveLegInput } from "../../src/contracts";
import type {
  Assignment,
  Difficulty,
  HexRecord,
  LegPlan,
  MapData,
  Region,
  RoleRoll,
  RosterMember,
} from "../../src/types";

const member = (uuid: string, food = 1, water = food): RosterMember => ({
  actorUuid: uuid,
  name: uuid,
  food,
  water,
  draft: false,
  npc: false,
});

const hex = (key: string, difficulty: Difficulty = "standard", region: string | null = null, tags: string[] = []): HexRecord => ({
  key,
  terrain: "plain",
  difficulty,
  region,
  tags,
});

const region = (id: string, extra: Partial<Region> = {}): Region => ({
  id,
  name: id,
  color: "#fff",
  encounterTable: null,
  dcMods: {},
  waterMultiplier: 1,
  stormThreshold: null,
  ...extra,
});

const plan = (extra: Partial<LegPlan> = {}): LegPlan => ({
  routeId: null,
  from: "0,0",
  path: ["0,1", "0,2"],
  baseDays: 2,
  difficulty: "standard",
  encounterBonus: 2,
  effects: [],
  prompts: [],
  regionId: null,
  ...extra,
});

const role = (id: string) => engine.DEFAULT_ROLES.find((r) => r.id === id)!;

function input(extra: Partial<ResolveLegInput> = {}): ResolveLegInput {
  return {
    plan: plan(),
    roles: engine.DEFAULT_ROLES,
    assignments: [],
    rolls: [],
    roster: [member("a")],
    hexes: {},
    regions: {},
    settings: engine.DEFAULT_SETTINGS,
    consecutiveForcedMarch: 0,
    ...extra,
  };
}

/** Resolve with only one role, held by actor "a" with the given total (or vacant when total is undefined). */
function single(roleId: string, total?: number, extra: Partial<ResolveLegInput> = {}) {
  const assignments: Assignment[] = total === undefined ? [] : [{ roleId, actorUuid: "a" }];
  const rolls: RoleRoll[] = total === undefined ? [] : [{ roleId, actorUuid: "a", total }];
  return engine.resolveLeg(input({ roles: [role(roleId)], assignments, rolls, ...extra }));
}

describe("defaults", () => {
  it("ships the seven KtP roles and settings", () => {
    expect(engine.DEFAULT_ROLES.map((r) => r.id)).toEqual([
      "navigator", "scout", "forager", "driver", "wainwright", "cartographer", "healer",
    ]);
    expect(engine.DEFAULT_SETTINGS).toEqual({ doublingPenalty: 4, forcedMarchBaseDc: 10, forcedMarchStep: 2 });
    for (const r of engine.DEFAULT_ROLES) expect(r.vacant).toEqual(r.failure);
  });
});

describe("consumption", () => {
  it("sums Medium + Large + construct to 3", () => {
    const roster = [member("med", 1), member("lg", 2), member("construct", 0)];
    expect(engine.consumption(roster)).toEqual({ food: 3, water: 3 });
    expect(engine.eaters(roster)).toBe(2);
  });
});

describe("roles", () => {
  it("navigator: success keeps days, failure and vacant add a day", () => {
    expect(single("navigator", 18).totalDays).toBe(2);
    expect(single("navigator", 17).totalDays).toBe(3);
    expect(single("navigator").totalDays).toBe(3);
  });

  it("scout: success avoids surprise, failure and vacant are surprised", () => {
    expect(single("scout", 18).surprised).toBe(false);
    expect(single("scout", 10).surprised).toBe(true);
    expect(single("scout").surprised).toBe(true);
  });

  it("forager: success offers a preserve choice each day, failure and vacant do not", () => {
    const ok = single("forager", 10);
    expect(ok.days.every((d) => d.preserveChoice)).toBe(true);
    expect(ok.days[0].drain.rations).toBe(1); // the plan never zeroes a track itself
    expect(single("forager", 9).days.some((d) => d.preserveChoice)).toBe(false);
    expect(single("forager").days.some((d) => d.preserveChoice)).toBe(false);
  });

  it("driver: failure and vacant add a day", () => {
    expect(single("driver", 15).totalDays).toBe(2);
    expect(single("driver", 14).totalDays).toBe(3);
    expect(single("driver").totalDays).toBe(3);
  });

  it("wainwright: success repairs 1/day, failure and vacant cost 1 extra", () => {
    expect(single("wainwright", 15).days[0].drain.wagon).toBe(0); // standard 1 - 1
    expect(single("wainwright", 14).days[0].drain.wagon).toBe(2);
    expect(single("wainwright").days[0].drain.wagon).toBe(2);
  });

  it("wainwright success on easy terrain repairs (negative drain)", () => {
    const hexes = { "0,1": hex("0,1", "easy"), "0,2": hex("0,2", "easy") };
    expect(single("wainwright", 20, { hexes }).days.map((d) => d.drain.wagon)).toEqual([-1, -1]);
  });

  it("cartographer: success maps, failure and vacant explore", () => {
    expect(single("cartographer", 15).mapState).toBe("mapped");
    expect(single("cartographer", 14).mapState).toBe("explored");
    expect(single("cartographer").mapState).toBe("explored");
  });

  it("defaults map state to explored when no role sets it", () => {
    expect(single("navigator", 20).mapState).toBe("explored");
  });

  it("healer: success rests, failure and vacant force a march", () => {
    expect(single("healer", 18).days.every((d) => d.forcedMarchDc === null)).toBe(true);
    expect(single("healer", 17).days.map((d) => d.forcedMarchDc)).toEqual([10, 12]);
    expect(single("healer").days.map((d) => d.forcedMarchDc)).toEqual([10, 12]);
  });

  it("treats an assigned but unrolled role as failure, reporting the holder", () => {
    const out = engine.resolveLeg(input({ roles: [role("navigator")], assignments: [{ roleId: "navigator", actorUuid: "a" }] }));
    expect(out.roles[0]).toMatchObject({ actorUuid: "a", total: null, success: false });
    expect(out.totalDays).toBe(3);
  });

  it("reports vacant roles with null actor and total", () => {
    const out = single("scout");
    expect(out.roles[0]).toEqual({ roleId: "scout", actorUuid: null, dc: 18, total: null, success: false, doubled: false });
  });

  it("all seven vacant stacks failures", () => {
    const out = engine.resolveLeg(input());
    expect(out.totalDays).toBe(4);
    expect(out.surprised).toBe(true);
    expect(out.days[0].drain.wagon).toBe(2);
    expect(out.days[0].forcedMarchDc).toBe(10);
  });
});

describe("doubling", () => {
  const assignments: Assignment[] = [
    { roleId: "navigator", actorUuid: "a" },
    { roleId: "scout", actorUuid: "a" },
    { roleId: "driver", actorUuid: "b" },
  ];

  it("detects actors holding two or more roles", () => {
    expect(engine.rolesHeldBy("a", assignments)).toEqual(["navigator", "scout"]);
    expect(engine.doublingPenalty("a", assignments, engine.DEFAULT_SETTINGS)).toBe(4);
    expect(engine.doublingPenalty("b", assignments, engine.DEFAULT_SETTINGS)).toBe(0);
    expect(engine.doublingPenalty("c", assignments, engine.DEFAULT_SETTINGS)).toBe(0);
  });

  it("marks doubled outcomes and compares the submitted total directly to the DC", () => {
    const rolls: RoleRoll[] = [
      { roleId: "navigator", actorUuid: "a", total: 18 },
      { roleId: "scout", actorUuid: "a", total: 17 },
      { roleId: "driver", actorUuid: "b", total: 15 },
    ];
    const out = engine.resolveLeg(input({ roles: [role("navigator"), role("scout"), role("driver")], assignments, rolls }));
    expect(out.roles.map((r) => [r.roleId, r.doubled, r.success, r.dc])).toEqual([
      ["navigator", true, true, 18],
      ["scout", true, false, 18],
      ["driver", false, true, 15],
    ]);
  });

  it("ignores rolls from someone other than the assignee", () => {
    const out = engine.resolveLeg(input({
      roles: [role("navigator")],
      assignments: [{ roleId: "navigator", actorUuid: "a" }],
      rolls: [{ roleId: "navigator", actorUuid: "b", total: 30 }],
    }));
    expect(out.roles[0].success).toBe(false);
  });
});

describe("DCs", () => {
  const seven = Array.from({ length: 7 }, (_, i) => member(`m${i}`));

  it("forager DC: 7 eaters => 22; non-eaters do not count", () => {
    expect(engine.roleDc(role("forager"), plan(), {}, [...seven, member("golem", 0)])).toBe(22);
    expect(engine.roleDc(role("forager"), plan(), {}, [member("solo")])).toBe(10);
  });

  it("forager DC drops 2 when the path holds a resource hex", () => {
    const hexes = { "0,2": hex("0,2", "standard", null, ["resource"]) };
    const out = single("forager", 20, { roster: seven, hexes });
    expect(out.roles[0].dc).toBe(20);
    expect(single("forager", 20, { roster: seven }).roles[0].dc).toBe(22);
  });

  it("applies region mods for '*' and the role id, and route dcMod effects", () => {
    const regions = { r: region("r", { dcMods: { "*": 2, navigator: 3, scout: -1 } }) };
    const p = plan({ regionId: "r", effects: [{ type: "dcMod", roleId: "navigator", mod: -4 }] });
    expect(engine.roleDc(role("navigator"), p, regions, [])).toBe(18 + 2 + 3 - 4);
    expect(engine.roleDc(role("scout"), p, regions, [])).toBe(18 + 2 - 1);
    expect(engine.roleDc(role("driver"), p, regions, [])).toBe(15 + 2);
    expect(engine.roleDc(role("driver"), plan(), regions, [])).toBe(15);
  });
});

describe("day plan", () => {
  it("spreads the path over extra days, entering the last hex only on the last day", () => {
    const p = plan({ path: ["0,1", "0,2", "0,3"], baseDays: 3 });
    expect(single("navigator", 20, { plan: p }).days.map((d) => d.hex)).toEqual(["0,1", "0,2", "0,3"]);
    const out = single("navigator", 0, { plan: p }); // +1 day
    expect(out.totalDays).toBe(4);
    expect(out.days.map((d) => d.hex)).toEqual(["0,0", "0,1", "0,2", "0,3"]);
    const six = single("navigator", 0, { plan: { ...p, baseDays: 5 } });
    expect(six.days.map((d) => d.hex)).toEqual(["0,0", "0,1", "0,1", "0,2", "0,2", "0,3"]);
  });

  it("stays at the start hex for an empty path", () => {
    const out = single("navigator", 20, { plan: plan({ path: [], baseDays: 0 }) });
    expect(out.totalDays).toBe(1);
    expect(out.days[0].hex).toBe("0,0");
  });

  it("integerises drain by cumulative ceiling (7.5/day over 2 days = 8 then 7)", () => {
    const roster = Array.from({ length: 7 }, (_, i) => member(`m${i}`)).concat(member("half", 0.5));
    const out = single("navigator", 20, { roster });
    expect(out.days.map((d) => d.drain.rations)).toEqual([8, 7]);
    expect(out.days.map((d) => d.drain.water)).toEqual([8, 7]);
  });

  it("does not round float noise up a whole day", () => {
    const roster = [member("tiny", 0.1)];
    const p = plan({ path: Array.from({ length: 30 }, (_, i) => `0,${i + 1}`), baseDays: 30 });
    const out = single("navigator", 20, { roster, plan: p });
    expect(out.days.reduce((s, d) => s + d.drain.rations, 0)).toBe(3);
  });

  it("multiplies water by the day's hex region, falling back to the plan region", () => {
    const regions = { hot: region("hot", { waterMultiplier: 2 }), mild: region("mild", { waterMultiplier: 1.5 }) };
    const hexes = { "0,1": hex("0,1", "standard", "hot"), "0,2": hex("0,2") };
    const out = single("navigator", 20, { hexes, regions, plan: plan({ regionId: "mild" }), roster: [member("a"), member("b")] });
    expect(out.days.map((d) => d.drain.water)).toEqual([4, 3]);
    expect(out.days.map((d) => d.drain.rations)).toEqual([2, 2]);
    expect(out.days.map((d) => d.regionId)).toEqual(["hot", "mild"]);
  });

  it("adds route extraDrain per day per track", () => {
    const p = plan({ effects: [
      { type: "extraDrain", track: "water", perDay: 1 },
      { type: "extraDrain", track: "wagon", perDay: 2 },
    ] });
    const out = single("wainwright", 20, { plan: p });
    expect(out.days[0].drain).toEqual({ rations: 1, water: 2, wagon: 2 });
  });

  it("uses hex difficulty for wagon drain and off-route encounter bonus, +2 on hunting grounds", () => {
    const hexes = { "0,1": hex("0,1", "brutal"), "0,2": hex("0,2", "easy", null, ["hunting-ground"]) };
    const out = single("navigator", 20, { hexes });
    expect(out.days.map((d) => d.drain.wagon)).toEqual([3, 0]);
    expect(out.days.map((d) => d.encounterBonus)).toEqual([10, 2]);
  });

  it("uses the route's encounter bonus on a route", () => {
    const hexes = { "0,1": hex("0,1", "brutal"), "0,2": hex("0,2", "easy", null, ["hunting-ground"]) };
    const out = single("navigator", 20, { hexes, plan: plan({ routeId: "r", encounterBonus: 1 }) });
    expect(out.days.map((d) => d.encounterBonus)).toEqual([1, 3]);
  });

  it("falls back to plan difficulty for unknown hexes", () => {
    const out = single("navigator", 20, { plan: plan({ difficulty: "hard" }) });
    expect(out.days.map((d) => d.drain.wagon)).toEqual([2, 2]);
    expect(out.days.map((d) => d.encounterBonus)).toEqual([5, 5]);
  });

  it("progresses forced march DCs with the carried-in streak", () => {
    const out = single("healer", undefined, { consecutiveForcedMarch: 2, plan: plan({ path: ["0,1", "0,2", "0,3"], baseDays: 3 }) });
    expect(out.days.map((d) => d.forcedMarchDc)).toEqual([14, 16, 18]);
    const custom = single("healer", undefined, { settings: { doublingPenalty: 4, forcedMarchBaseDc: 12, forcedMarchStep: 3 } });
    expect(custom.days.map((d) => d.forcedMarchDc)).toEqual([12, 15]);
  });
});

describe("prompts and replenish", () => {
  it("routes day prompts to their day and role prompts to arrival", () => {
    const p = plan({
      prompts: [
        { when: { kind: "day", day: 2 }, text: "dunes" },
        { when: { kind: "roleSuccess", roleId: "navigator" }, text: "nav ok" },
        { when: { kind: "roleFailure", roleId: "navigator" }, text: "nav bad" },
        { when: { kind: "roleFailure", roleId: "scout" }, text: "scout bad" },
        { when: { kind: "roleSuccess", roleId: "nobody" }, text: "ghost" },
      ],
      effects: [{ type: "replenish", track: "water", amount: 10 }, { type: "extraDrain", track: "rations", perDay: 1 }],
    });
    const out = engine.resolveLeg(input({
      plan: p,
      roles: [role("navigator"), role("scout")],
      assignments: [{ roleId: "navigator", actorUuid: "a" }],
      rolls: [{ roleId: "navigator", actorUuid: "a", total: 20 }],
    }));
    expect(out.days.map((d) => d.prompts)).toEqual([[], ["dunes"]]);
    expect(out.arrivalPrompts).toEqual(["nav ok", "scout bad"]);
    expect(out.replenish).toEqual([{ type: "replenish", track: "water", amount: 10 }]);
  });
});

describe("plans", () => {
  const map: MapData = {
    hexes: {
      "0,1": hex("0,1", "easy", "north"),
      "0,2": hex("0,2", "hard", "dunes"),
      "0,3": hex("0,3", "standard", "south"),
    },
    regions: {},
    landmarks: {},
    routes: {
      salt: {
        id: "salt",
        name: "Salt Road",
        hexes: ["0,1", "0,2", "0,3"],
        from: "0,0",
        days: 4,
        difficulty: "hard",
        encounterBonus: 3,
        bargain: "slow but safe",
        effects: [{ type: "extraDrain", track: "water", perDay: 1 }],
        prompts: [{ when: { kind: "day", day: 1 }, text: "hi" }],
        knownToParty: true,
      },
    },
  };

  it("planFromRoute copies route fields and takes the last hex's region", () => {
    expect(engine.planFromRoute(map, "salt")).toEqual({
      routeId: "salt",
      from: "0,0",
      path: ["0,1", "0,2", "0,3"],
      baseDays: 4,
      difficulty: "hard",
      encounterBonus: 3,
      effects: [{ type: "extraDrain", track: "water", perDay: 1 }],
      prompts: [{ when: { kind: "day", day: 1 }, text: "hi" }],
      regionId: "south",
    });
    expect(() => engine.planFromRoute(map, "nope")).toThrow();
  });

  it("planFromPath uses the hardest hex for difficulty and region", () => {
    expect(engine.planFromPath(map, "0,0", ["0,1", "0,2", "0,3"])).toEqual({
      routeId: null,
      from: "0,0",
      path: ["0,1", "0,2", "0,3"],
      baseDays: 3,
      difficulty: "hard",
      encounterBonus: 5,
      effects: [],
      prompts: [],
      regionId: "dunes",
    });
  });

  it("planFromPath treats missing hexes as standard", () => {
    const p = engine.planFromPath(map, "0,0", ["0,1", "9,9"]);
    expect(p.difficulty).toBe("standard");
    expect(p.regionId).toBeNull();
    expect(p.encounterBonus).toBe(2);
  });
});

describe("hexAdjacent", () => {
  // Offsets are `${row},${col}`.
  it("row grid, odd rows shoved (even = false)", () => {
    const adj = (b: string) => engine.hexAdjacent("1,1", b, false, false);
    for (const b of ["1,0", "1,2", "0,1", "0,2", "2,1", "2,2"]) expect(adj(b)).toBe(true);
    for (const b of ["0,0", "2,0", "1,1", "1,3", "3,1"]) expect(adj(b)).toBe(false);
    // even row neighbours lean left
    expect(engine.hexAdjacent("2,1", "1,0", false, false)).toBe(true);
    expect(engine.hexAdjacent("2,1", "1,2", false, false)).toBe(false);
  });

  it("row grid, even rows shoved (even = true)", () => {
    const adj = (b: string) => engine.hexAdjacent("1,1", b, false, true);
    for (const b of ["1,0", "1,2", "0,0", "0,1", "2,0", "2,1"]) expect(adj(b)).toBe(true);
    expect(adj("0,2")).toBe(false);
  });

  it("column grid, odd columns shoved (even = false)", () => {
    const adj = (b: string) => engine.hexAdjacent("1,1", b, true, false);
    for (const b of ["0,1", "2,1", "1,0", "2,0", "1,2", "2,2"]) expect(adj(b)).toBe(true);
    for (const b of ["0,0", "0,2", "3,1"]) expect(adj(b)).toBe(false);
  });

  it("column grid, even columns shoved (even = true)", () => {
    const adj = (b: string) => engine.hexAdjacent("1,1", b, true, true);
    for (const b of ["0,1", "2,1", "0,0", "1,0", "0,2", "1,2"]) expect(adj(b)).toBe(true);
    expect(adj("2,0")).toBe(false);
  });
});

describe("rolling", () => {
  it("seeded roller is deterministic and stays in 1..20", () => {
    const a = engine.seededRoller(42);
    const b = engine.seededRoller(42);
    const seqA = Array.from({ length: 500 }, () => a.d20());
    const seqB = Array.from({ length: 500 }, () => b.d20());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((n) => Number.isInteger(n) && n >= 1 && n <= 20)).toBe(true);
    expect(new Set(seqA).size).toBe(20);
    const c = engine.seededRoller(7);
    expect(Array.from({ length: 20 }, () => c.d20())).not.toEqual(seqA.slice(0, 20));
  });

  it("encounter total = d20 + journey day + bonus", () => {
    expect(engine.encounterTotal({ d20: () => 11 }, 4, 5)).toEqual({ d20: 11, total: 20 });
  });
});

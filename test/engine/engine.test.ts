import { describe, expect, it } from "vitest";
import { engine } from "../../src/engine";
import type { Roller } from "../../src/contracts";
import type {
  DayContext,
  HexRecord,
  MapData,
  Region,
  Route,
  Terrain,
  UcTag,
  VehicleInfo,
  WalkerInfo,
} from "../../src/types";

// ---------- builders ----------

const hex = (key: string, terrain: Terrain = "plains", tags: UcTag[] = [], region: string | null = null): HexRecord => ({
  key,
  terrain,
  region,
  tags,
});

/** A row of hexes "0,0".."0,n-1", all of one terrain unless overridden. */
function mapOf(terrain: Terrain = "plains", overrides: HexRecord[] = [], extra: Partial<MapData> = {}): MapData {
  const hexes: Record<string, HexRecord> = {};
  for (let j = 0; j < 6; j++) hexes[`0,${j}`] = hex(`0,${j}`, terrain);
  for (const h of overrides) hexes[h.key] = h;
  return { hexes, regions: {}, landmarks: {}, routes: {}, ...extra };
}

const route = (kind: "highway" | "road", chain: string[]): Route => ({
  id: `r-${kind}`,
  name: kind,
  from: chain[0],
  hexes: chain.slice(1),
  kind,
  knownToParty: true,
});

const wagon = (patch: Partial<VehicleInfo> = {}): VehicleInfo => ({
  actorUuid: "w1",
  name: "Wagon",
  milesPerDay: 16,
  hp: 30,
  maxHp: 30,
  cargo: 500,
  cargoCapacity: 1000,
  teamStrength: 2,
  teamRequired: 2,
  driver: "drv",
  ...patch,
});

const walker = (name: string, landSpeed: number): WalkerInfo => ({ actorUuid: name, name, landSpeed });

function ctx(patch: Partial<DayContext> = {}): DayContext {
  return {
    activity: "travel",
    position: "0,0",
    course: ["0,1", "0,2", "0,3"],
    map: mapOf(),
    knowledge: {},
    eaters: [
      { actorUuid: "a", food: 1, water: 1, wage: 0 },
      { actorUuid: "b", food: 1, water: 1, wage: 30 },
    ],
    vehicles: [wagon()],
    walkers: [],
    roles: { navigator: "nav", scout: "sco", forager: "for", wainwright: "wai", cartographer: "car", healer: "hea" },
    rolesHeld: { nav: 1, sco: 1, for: 1, wai: 1, car: 1, hea: 1, drv: 1 },
    stock: { rations: 100, water: 100 },
    funds: 5000,
    tripDay: 1,
    exploreDays: 0,
    settings: { doublingPenalty: 4 },
    ...patch,
  };
}

/** Totals for every check in the day's preview, with optional overrides. */
function totals(c: DayContext, value: number, over: Record<string, number | null> = {}): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const check of engine.dayPreview(c).checks) out[check.id] = value;
  return { ...out, ...over };
}
const PASS = 50;
const FAIL = 0;

/** Roller that always rolls the maximum on dice and a fixed d20. */
const maxRoller = (d20 = 10): Roller => ({ d20: () => d20, die: (s) => s });

const dc = (c: DayContext, id: string) => engine.dayPreview(c).checks.find((x) => x.id === id)?.dc;
const check = (c: DayContext, id: string) => engine.dayPreview(c).checks.find((x) => x.id === id);

// ---------- rules ----------

describe("rulesFor", () => {
  const region: Region = {
    id: "reg",
    name: "Stormlands",
    color: "#ff0000",
    encounterTable: "Table.storm",
    dcMods: { "*": 5 },
    rationsMultiplier: 1,
    waterMultiplier: 2,
  };
  const rules = { encounterTable: "Table.map", dcMods: {}, rationsMultiplier: 1, waterMultiplier: 1 };

  it("uses the hex's region", () => {
    const map = mapOf("plains", [hex("0,1", "plains", [], "reg")], { regions: { reg: region }, rules });
    expect(engine.rulesFor(map, "0,1").encounterTable).toBe("Table.storm");
    expect(engine.rulesFor(map, "0,1").waterMultiplier).toBe(2);
  });
  it("falls back to map.rules, then defaults", () => {
    expect(engine.rulesFor(mapOf("plains", [], { rules }), "0,1").encounterTable).toBe("Table.map");
    expect(engine.rulesFor(mapOf(), "9,9")).toEqual({ encounterTable: null, dcMods: {}, rationsMultiplier: 1, waterMultiplier: 1 });
  });
});

// ---------- pace ----------

describe("pace", () => {
  it("a walker slower than the wagon sets pace", () => {
    const p = engine.pace(ctx({ walkers: [walker("Slowpoke", 15)] }));
    expect(p).toEqual({ milesPerDay: 12, setBy: "Slowpoke", blocked: null });
  });
  it("the wagon sets pace over a faster walker", () => {
    expect(engine.pace(ctx({ walkers: [walker("Elf", 30)] })).setBy).toBe("Wagon");
  });
  it("broken (more than half HP lost) halves the vehicle's pace; exactly half is not broken", () => {
    expect(engine.pace(ctx({ vehicles: [wagon({ hp: 14 })] })).milesPerDay).toBe(8);
    expect(engine.pace(ctx({ vehicles: [wagon({ hp: 15 })] })).milesPerDay).toBe(16);
  });
  it("unknown HP (maxHp 0) is neither wrecked nor broken", () => {
    const p = engine.pace(ctx({ vehicles: [wagon({ hp: 0, maxHp: 0 })] }));
    expect(p.blocked).toBeNull();
    expect(p.milesPerDay).toBe(16);
  });
  it("1.5x cargo is one category slower", () => {
    const p = engine.pace(ctx({ vehicles: [wagon({ cargo: 1500 })] }));
    expect(p.milesPerDay).toBe(12);
    expect(p.blocked).toBeNull();
  });
  it("2.1x cargo blocks", () => {
    expect(engine.pace(ctx({ vehicles: [wagon({ cargo: 2100 })] })).blocked).toBe("Wagon is overloaded");
  });
  it("no driver blocks", () => {
    expect(engine.pace(ctx({ vehicles: [wagon({ driver: null })] })).blocked).toBe("Wagon has no driver");
  });
  it("a short team blocks", () => {
    expect(engine.pace(ctx({ vehicles: [wagon({ teamStrength: 1 })] })).blocked).toBe("Wagon is short of draft animals");
  });
  it("wrecked blocks", () => {
    expect(engine.pace(ctx({ vehicles: [wagon({ hp: 0 })] })).blocked).toBe("Wagon is wrecked");
  });
  it("nobody at all → 24 default", () => {
    expect(engine.pace(ctx({ vehicles: [] }))).toEqual({ milesPerDay: 24, setBy: "default", blocked: null });
  });
  it("other land speeds use ft × 0.8", () => {
    expect(engine.pace(ctx({ vehicles: [], walkers: [walker("Odd", 25)] })).milesPerDay).toBe(20);
  });
});

// ---------- movement ----------

describe("movement", () => {
  it("a 16-mile wagon makes 1 hex in trackless forest, never less", () => {
    const pv = engine.dayPreview(ctx({ map: mapOf("forest") }));
    expect(pv.moving).toBe(true);
    expect(pv.hexes).toEqual(["0,1"]);
    expect(pv.road).toBe(false);
  });
  it("a 24-mile walker party makes 2 on a highway", () => {
    const map = mapOf("plains", [], { routes: { h: route("highway", ["0,0", "0,1", "0,2", "0,3"]) } });
    const pv = engine.dayPreview(ctx({ map, vehicles: [], walkers: [walker("A", 30)] }));
    expect(pv.hexes).toEqual(["0,1", "0,2"]);
    expect(pv.road).toBe(true);
  });
  it("is capped at the course length", () => {
    const map = mapOf("plains", [], { routes: { h: route("highway", ["0,0", "0,1"]) } });
    const pv = engine.dayPreview(ctx({ map, vehicles: [], walkers: [walker("A", 50)], course: ["0,1"] }));
    expect(pv.hexes).toEqual(["0,1"]);
  });
  it("stops before an impassable hex", () => {
    const map = mapOf("plains", [hex("0,2", "water")], { routes: { h: route("highway", ["0,0", "0,1", "0,2"]) } });
    const pv = engine.dayPreview(ctx({ map, vehicles: [], walkers: [walker("A", 30)] }));
    expect(pv.hexes).toEqual(["0,1"]);
  });
  it("an impassable first hex blocks the day", () => {
    const pv = engine.dayPreview(ctx({ map: mapOf("plains", [hex("0,1", "water")]) }));
    expect(pv.moving).toBe(false);
    expect(pv.hexes).toEqual([]);
    expect(pv.pace.blocked).toBe("the way is impassable");
  });
  it("a road step reversed still counts as road", () => {
    const map = mapOf("plains", [], { routes: { r: route("road", ["0,3", "0,2", "0,1", "0,0"]) } });
    const pv = engine.dayPreview(ctx({ map, vehicles: [], walkers: [walker("A", 30)] }));
    expect(pv.hexes).toEqual(["0,1", "0,2"]);
    expect(pv.road).toBe(true);
  });
  it("a blocked caravan doesn't move", () => {
    const pv = engine.dayPreview(ctx({ vehicles: [wagon({ driver: null })] }));
    expect(pv.moving).toBe(false);
    expect(pv.checks.map((c) => c.id)).toEqual(["scout", "forager", "healer"]);
  });
});

// ---------- DCs ----------

describe("check DCs", () => {
  it("lists the moving-day checks in order", () => {
    expect(engine.dayPreview(ctx()).checks.map((c) => c.id)).toEqual([
      "navigator",
      "driver:w1",
      "scout",
      "forager",
      "wainwright",
      "cartographer",
      "healer",
    ]);
    expect(check(ctx(), "driver:w1")?.label).toBe("Driver (Wagon)");
    expect(check(ctx(), "driver:w1")?.actorUuid).toBe("drv");
    expect(check(ctx(), "driver:w1")?.skills).toEqual(["han", "pro"]);
    expect(check(ctx(), "healer")?.label).toBe("Healer/Cook");
  });
  it("rest-day checks: scout, forager, wainwright, healer", () => {
    expect(engine.dayPreview(ctx({ activity: "rest" })).checks.map((c) => c.id)).toEqual(["scout", "forager", "wainwright", "healer"]);
    expect(engine.dayPreview(ctx({ activity: "forage" })).checks.map((c) => c.id)).toEqual(["scout", "forager", "healer"]);
  });
  it("navigator: lost DC of the first hex + 4", () => {
    expect(dc(ctx(), "navigator")).toBe(18);
    expect(dc(ctx({ map: mapOf("forest") }), "navigator")).toBe(20);
    expect(dc(ctx({ map: mapOf("hills") }), "navigator")).toBe(14);
  });
  it("scout 18, cartographer 15, healer 15", () => {
    expect(dc(ctx(), "scout")).toBe(18);
    expect(dc(ctx(), "cartographer")).toBe(15);
    expect(dc(ctx(), "healer")).toBe(15);
  });
  it("forager: 10 + 2 × (eaters − 1), sandy desert +10, resource −2", () => {
    const four = [1, 1, 1, 1].map((food, i) => ({ actorUuid: `e${i}`, food, water: 1, wage: 0 }));
    const withConstruct = [...four, { actorUuid: "golem", food: 0, water: 0, wage: 0 }];
    expect(dc(ctx({ eaters: four }), "forager")).toBe(16);
    expect(dc(ctx({ eaters: withConstruct }), "forager")).toBe(16);
    expect(dc(ctx({ eaters: [] }), "forager")).toBe(10);
    expect(dc(ctx({ activity: "rest", map: mapOf("desert-sandy") }), "forager")).toBe(22);
    expect(dc(ctx({ activity: "rest", map: mapOf("plains", [hex("0,0", "plains", ["resource"])]) }), "forager")).toBe(10);
  });
  it("forager DC uses the first hex entered when moving", () => {
    expect(dc(ctx({ map: mapOf("plains", [hex("0,1", "desert-sandy")]) }), "forager")).toBe(22);
  });
  it("driver: 5 + 5 per trackless step, difficult +5", () => {
    expect(dc(ctx({ map: mapOf("settlement") }), "driver:w1")).toBe(5);
    expect(dc(ctx(), "driver:w1")).toBe(10);
    expect(dc(ctx({ map: mapOf("forest") }), "driver:w1")).toBe(15);
    expect(dc(ctx({ map: mapOf("jungle") }), "driver:w1")).toBe(20);
    expect(dc(ctx({ map: mapOf("forest", [hex("0,1", "forest", ["difficult"])]) }), "driver:w1")).toBe(20);
  });
  it("wainwright: 15 moving, 10 resting", () => {
    expect(dc(ctx(), "wainwright")).toBe(15);
    expect(dc(ctx({ activity: "rest" }), "wainwright")).toBe(10);
  });
  it("region DC mods add to every DC (\"*\" and per role)", () => {
    const region: Region = {
      id: "storm",
      name: "Stormlands",
      color: "#000",
      encounterTable: null,
      dcMods: { "*": 5, navigator: 2, driver: 1 },
      rationsMultiplier: 1,
      waterMultiplier: 1,
    };
    const map = mapOf("plains", [hex("0,1", "plains", [], "storm")], { regions: { storm: region } });
    expect(dc(ctx({ map }), "navigator")).toBe(25);
    expect(dc(ctx({ map }), "driver:w1")).toBe(16);
    expect(dc(ctx({ map }), "scout")).toBe(23);
    // Resting at the start hex (outside the region): no mod.
    expect(dc(ctx({ map, activity: "rest" }), "scout")).toBe(18);
  });
  it("doubling penalty when an actor holds two roles", () => {
    const c = ctx({ roles: { navigator: "nav", scout: "nav" }, rolesHeld: { nav: 2, drv: 1 } });
    expect(check(c, "navigator")?.penalty).toBe(4);
    expect(check(c, "scout")?.penalty).toBe(4);
    expect(check(c, "driver:w1")?.penalty).toBe(0);
    const out = engine.resolveDay(c, totals(c, 21), maxRoller());
    const nav = out.checks.find((x) => x.id === "navigator")!;
    expect(nav.total).toBe(17);
    expect(nav.success).toBe(false);
    expect(out.lost).toBe(true);
  });
  it("Navigator +4 in a Mapped hex", () => {
    const c = ctx({ knowledge: { "0,1": "mapped" } });
    expect(check(c, "navigator")?.bonus).toBe(4);
    expect(check(ctx({ knowledge: { "0,1": "explored" } }), "navigator")?.bonus).toBe(0);
    const out = engine.resolveDay(c, totals(c, 14), maxRoller());
    expect(out.checks.find((x) => x.id === "navigator")).toMatchObject({ total: 18, success: true });
    expect(out.lost).toBe(false);
  });
  it("vacant roles fail with no total", () => {
    const c = ctx({ roles: { navigator: null } });
    expect(check(c, "scout")?.actorUuid).toBeNull();
    const out = engine.resolveDay(c, totals(c, PASS), maxRoller());
    expect(out.checks.find((x) => x.id === "scout")).toMatchObject({ total: null, success: false });
    expect(out.lost).toBe(true);
    expect(out.surprised).toBe(true);
  });
  it("an unreadable roll fails", () => {
    const c = ctx();
    const out = engine.resolveDay(c, totals(c, PASS, { healer: null }), maxRoller());
    expect(out.checks.find((x) => x.id === "healer")).toMatchObject({ total: null, success: false });
    expect(out.longTermCare).toBe(false);
  });
});

// ---------- resolving the day ----------

describe("road days", () => {
  const map = mapOf("plains", [], { routes: { r: route("road", ["0,0", "0,1", "0,2", "0,3"]) } });
  it("navigator and drivers are automatic and there is no wear", () => {
    const c = ctx({ map });
    const pv = engine.dayPreview(c);
    expect(pv.road).toBe(true);
    expect(pv.checks.find((x) => x.id === "navigator")).toMatchObject({ auto: true, penalty: 0, bonus: 0 });
    expect(pv.checks.find((x) => x.id === "driver:w1")?.auto).toBe(true);
    const out = engine.resolveDay(c, totals(c, FAIL), maxRoller());
    expect(out.lost).toBe(false);
    expect(out.moved).toEqual(["0,1"]);
    expect(out.checks.find((x) => x.id === "navigator")).toMatchObject({ total: null, success: true });
    expect(out.wear).toEqual([]);
  });
});

describe("wear", () => {
  it("1d4 on plains", () => {
    const c = ctx({ roles: { ...ctx().roles, wainwright: null } });
    const out = engine.resolveDay(c, totals(c, PASS), maxRoller());
    expect(out.wear).toEqual([{ vehicleUuid: "w1", dice: "1d4", damage: 4 }]);
  });
  it("2d6 in forest with a failed driver", () => {
    const c = ctx({ map: mapOf("forest") });
    const out = engine.resolveDay(c, totals(c, PASS, { "driver:w1": FAIL, wainwright: FAIL }), maxRoller());
    expect(out.wear).toEqual([{ vehicleUuid: "w1", dice: "2d6", damage: 12 }]);
  });
  it("1d8 in a difficult forest hex", () => {
    const c = ctx({ map: mapOf("forest", [hex("0,1", "forest", ["difficult"])]) });
    const out = engine.resolveDay(c, totals(c, PASS, { wainwright: FAIL }), maxRoller());
    expect(out.moved).toEqual(["0,1"]);
    expect(out.wear).toEqual([{ vehicleUuid: "w1", dice: "1d8", damage: 8 }]);
  });
  it("a Wainwright success cancels the wear", () => {
    const c = ctx();
    expect(engine.resolveDay(c, totals(c, PASS), maxRoller()).wear).toEqual([]);
  });
  it("no wear when lost", () => {
    const c = ctx();
    expect(engine.resolveDay(c, totals(c, PASS, { navigator: FAIL, wainwright: FAIL }), maxRoller()).wear).toEqual([]);
  });
});

describe("navigation and mapping", () => {
  it("a lost navigator makes no progress", () => {
    const c = ctx();
    const out = engine.resolveDay(c, totals(c, PASS, { navigator: FAIL }), maxRoller());
    expect(out.lost).toBe(true);
    expect(out.moved).toEqual([]);
    expect(out.end).toBe("0,0");
    expect(out.knowledge).toEqual({});
    expect(out.done).toBe(false);
  });
  it("cartographer success maps the hexes entered", () => {
    const c = ctx();
    const out = engine.resolveDay(c, totals(c, PASS), maxRoller());
    expect(out.moved).toEqual(["0,1"]);
    expect(out.end).toBe("0,1");
    expect(out.knowledge).toEqual({ "0,1": "mapped" });
  });
  it("cartographer failure explores them, never lowering knowledge", () => {
    const c = ctx();
    expect(engine.resolveDay(c, totals(c, PASS, { cartographer: FAIL }), maxRoller()).knowledge).toEqual({ "0,1": "explored" });
    const known = ctx({ knowledge: { "0,1": "mapped" } });
    expect(engine.resolveDay(known, totals(known, PASS, { cartographer: FAIL }), maxRoller()).knowledge).toEqual({});
  });
  it("done when the course is finished", () => {
    const c = ctx({ course: ["0,1"] });
    expect(engine.resolveDay(c, totals(c, PASS), maxRoller()).done).toBe(true);
    const longer = ctx();
    expect(engine.resolveDay(longer, totals(longer, PASS), maxRoller()).done).toBe(false);
  });
});

describe("supplies and wages", () => {
  it("drains food and water by the end hex's multipliers and pays wages", () => {
    const region: Region = {
      id: "desert",
      name: "Desert",
      color: "#fc0",
      encounterTable: null,
      dcMods: {},
      rationsMultiplier: 1,
      waterMultiplier: 2,
    };
    const map = mapOf("plains", [hex("0,1", "plains", [], "desert")], { regions: { desert: region } });
    const c = ctx({ map });
    const out = engine.resolveDay(c, totals(c, PASS, { forager: FAIL }), maxRoller());
    expect(out.drain).toEqual({ rations: 2, water: 4 });
    expect(out.preserved).toEqual([]);
    expect(out.wages).toBe(30);
  });
  it("forager success preserves the track with fewer days left", () => {
    const c = ctx({ stock: { rations: 4, water: 10 } });
    const out = engine.resolveDay(c, totals(c, PASS), maxRoller());
    expect(out.preserved).toEqual(["rations"]);
    expect(out.drain).toEqual({ rations: 0, water: 2 });
    const w = ctx({ stock: { rations: 10, water: 4 } });
    expect(engine.resolveDay(w, totals(w, PASS), maxRoller()).preserved).toEqual(["water"]);
  });
  it("ties go to water", () => {
    const c = ctx({ stock: { rations: 10, water: 10 } });
    expect(engine.resolveDay(c, totals(c, PASS), maxRoller()).preserved).toEqual(["water"]);
  });
  it("a zero drain counts as infinite days", () => {
    const c = ctx({ eaters: [{ actorUuid: "a", food: 0, water: 1, wage: 0 }], stock: { rations: 0, water: 50 } });
    expect(engine.resolveDay(c, totals(c, PASS), maxRoller()).preserved).toEqual(["water"]);
  });
  it("forage success preserves both tracks", () => {
    const c = ctx({ activity: "forage" });
    const out = engine.resolveDay(c, totals(c, PASS), maxRoller());
    expect(out.preserved).toEqual(["rations", "water"]);
    expect(out.drain).toEqual({ rations: 0, water: 0 });
    expect(out.done).toBe(true);
  });
});

describe("rest-day repair", () => {
  const damaged = [wagon({ actorUuid: "w1", hp: 25 }), wagon({ actorUuid: "w2", name: "Cart", hp: 12, maxHp: 20 })];
  it("repairs 10 HP on the most damaged vehicle for 10 gp", () => {
    const c = ctx({ activity: "rest", vehicles: damaged });
    const out = engine.resolveDay(c, totals(c, PASS), maxRoller());
    expect(out.repair).toEqual({ vehicleUuid: "w2", hp: 8, cost: 1000 }); // capped at max HP (8 missing)
    expect(out.moved).toEqual([]);
    expect(out.wear).toEqual([]);
    expect(out.done).toBe(true);
  });
  it("repairs 5 HP on a failure", () => {
    const c = ctx({ activity: "rest", vehicles: damaged });
    expect(engine.resolveDay(c, totals(c, PASS, { wainwright: FAIL }), maxRoller()).repair).toEqual({ vehicleUuid: "w2", hp: 5, cost: 1000 });
  });
  it("repairs 10 HP when 10 or more are missing", () => {
    const c = ctx({ activity: "rest", vehicles: [wagon({ hp: 10 })] });
    expect(engine.resolveDay(c, totals(c, PASS), maxRoller()).repair).toEqual({ vehicleUuid: "w1", hp: 10, cost: 1000 });
  });
  it("no repair without funds, without a wainwright, or with nothing damaged", () => {
    const poor = ctx({ activity: "rest", vehicles: damaged, funds: 999 });
    expect(engine.resolveDay(poor, totals(poor, PASS), maxRoller()).repair).toBeNull();
    const vacant = ctx({ activity: "rest", vehicles: damaged, roles: { wainwright: null } });
    expect(engine.resolveDay(vacant, totals(vacant, PASS), maxRoller()).repair).toBeNull();
    const fine = ctx({ activity: "rest" });
    expect(engine.resolveDay(fine, totals(fine, PASS), maxRoller()).repair).toBeNull();
  });
});

describe("exploration", () => {
  it("UC exploration time by pace and terrain", () => {
    expect(engine.exploreDaysNeeded(mapOf("forest"), "0,0", 24)).toBe(2);
    expect(engine.exploreDaysNeeded(mapOf("forest", [hex("0,0", "forest", ["secret"])]), "0,0", 24)).toBe(3);
    expect(engine.exploreDaysNeeded(mapOf("plains"), "0,0", 12)).toBe(3);
    expect(engine.exploreDaysNeeded(mapOf("mountains"), "0,0", 16)).toBe(4);
    expect(engine.exploreDaysNeeded(mapOf("plains"), "0,0", 8)).toBe(3);
    expect(engine.exploreDaysNeeded(mapOf("mountains"), "0,0", 32)).toBe(2);
    expect(engine.exploreDaysNeeded(mapOf("mountains"), "0,0", 48)).toBe(1);
  });
  it("reveals and maps the hex on the last day", () => {
    const base = { activity: "explore" as const, map: mapOf("forest"), vehicles: [], walkers: [walker("A", 30)] };
    const first = ctx({ ...base, exploreDays: 0 });
    const day1 = engine.resolveDay(first, totals(first, PASS), maxRoller());
    expect(day1.exploreDaysNeeded).toBe(2);
    expect(day1.revealed).toBeNull();
    expect(day1.done).toBe(false);
    expect(day1.moved).toEqual([]);
    const second = ctx({ ...base, exploreDays: 1 });
    const day2 = engine.resolveDay(second, totals(second, PASS), maxRoller());
    expect(day2.revealed).toBe("0,0");
    expect(day2.knowledge).toEqual({ "0,0": "mapped" });
    expect(day2.done).toBe(true);
  });
  it("other activities need no exploration days", () => {
    const c = ctx({ activity: "rest" });
    expect(engine.resolveDay(c, totals(c, PASS), maxRoller()).exploreDaysNeeded).toBe(0);
  });
});

describe("encounters", () => {
  it("d20 + trip day + 2 on a hunting ground, from the end hex's table", () => {
    const map = mapOf("plains", [hex("0,1", "plains", ["hunting-ground"])], {
      rules: { encounterTable: "Table.wild", dcMods: {}, rationsMultiplier: 1, waterMultiplier: 1 },
    });
    const c = ctx({ map, tripDay: 3 });
    const out = engine.resolveDay(c, totals(c, PASS), maxRoller(7));
    expect(out.encounter).toEqual({ d20: 7, bonus: 5, total: 12, table: "Table.wild" });
    expect(out.surprised).toBe(false);
  });
  it("the Scout's failure means surprise", () => {
    const c = ctx();
    expect(engine.resolveDay(c, totals(c, PASS, { scout: FAIL }), maxRoller()).surprised).toBe(true);
  });
});

describe("determinism and dice", () => {
  it("same seed → same outcome", () => {
    const c = ctx({ map: mapOf("forest") });
    const t = totals(c, PASS, { "driver:w1": FAIL, wainwright: FAIL });
    const a = engine.resolveDay(c, t, engine.seededRoller(42));
    const b = engine.resolveDay(c, t, engine.seededRoller(42));
    expect(a).toEqual(b);
  });
  it("seeded dice stay in range", () => {
    const r = engine.seededRoller(7);
    for (let i = 0; i < 200; i++) {
      const d = r.die(6);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);
      const t = r.d20();
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(20);
    }
  });
  it("hexAdjacent on a row-based grid", () => {
    expect(engine.hexAdjacent("0,0", "0,1", false, false)).toBe(true);
    expect(engine.hexAdjacent("0,0", "0,2", false, false)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  applyBrush,
  colorToNumber,
  dashSegments,
  extendPath,
  formatDcMods,
  parseDcMods,
  parseEffects,
  parsePrompts,
  polylineMidpoint,
  starPoints,
} from "../../src/canvas/helpers";
import { TERRAINS, terrainFill } from "../../src/canvas/terrain";
import type { MapData } from "../../src/types";

const empty = (): MapData => ({ hexes: {}, regions: {}, landmarks: {}, routes: {} });
const fallback = { terrain: "plains", difficulty: "easy" as const };

describe("applyBrush", () => {
  it("paints terrain without mutating the input", () => {
    const map = empty();
    const next = applyBrush(map, ["0,0", "0,1"], { kind: "terrain", terrain: "desert", difficulty: "hard" }, fallback);
    expect(map.hexes).toEqual({});
    expect(next.hexes["0,1"]).toEqual({ key: "0,1", terrain: "desert", difficulty: "hard", region: null, tags: [] });
  });

  it("assigns regions, toggles tags and erases", () => {
    let map = applyBrush(empty(), ["1,1"], { kind: "region", regionId: "r1" }, fallback);
    expect(map.hexes["1,1"]).toMatchObject({ terrain: "plains", region: "r1" });
    map = applyBrush(map, ["1,1"], { kind: "tag", tag: "resource", add: true }, fallback);
    map = applyBrush(map, ["1,1"], { kind: "tag", tag: "resource", add: true }, fallback);
    expect(map.hexes["1,1"].tags).toEqual(["resource"]);
    map = applyBrush(map, ["1,1"], { kind: "tag", tag: "resource", add: false }, fallback);
    expect(map.hexes["1,1"].tags).toEqual([]);
    map = applyBrush(map, ["1,1"], { kind: "erase" }, fallback);
    expect(map.hexes["1,1"]).toBeUndefined();
  });
});

describe("extendPath", () => {
  const adjacent = (a: string, b: string) => {
    const [ai, aj] = a.split(",").map(Number);
    const [bi, bj] = b.split(",").map(Number);
    return Math.abs(ai - bi) + Math.abs(aj - bj) === 1;
  };

  it("appends adjacent hexes, rejects others, and pops on clicking the last", () => {
    let r = extendPath("0,0", [], "0,1", adjacent);
    expect(r.path).toEqual(["0,1"]);
    r = extendPath("0,0", r.path, "5,5", adjacent);
    expect(r.error).toBeTruthy();
    expect(r.path).toEqual(["0,1"]);
    r = extendPath("0,0", r.path, "0,0", adjacent);
    expect(r.error).toBeTruthy();
    r = extendPath("0,0", r.path, "0,1", adjacent);
    expect(r.path).toEqual([]);
  });
});

describe("DC mods", () => {
  it("round-trips role:mod text", () => {
    const mods = parseDcMods("navigator:2, *:-1\nscout:+3");
    expect(mods).toEqual({ navigator: 2, "*": -1, scout: 3 });
    expect(parseDcMods(formatDcMods(mods))).toEqual(mods);
    expect(parseDcMods("  ")).toEqual({});
    expect(() => parseDcMods("navigator")).toThrow();
  });
});

describe("route JSON validation", () => {
  it("accepts valid effects and prompts", () => {
    expect(parseEffects('[{"type":"replenish","track":"either","amount":3},{"type":"setMapState","state":"mapped"}]')).toHaveLength(2);
    expect(parsePrompts('[{"when":{"kind":"day","day":2},"text":"Storm"}]')).toHaveLength(1);
    expect(parseEffects("")).toEqual([]);
  });

  it("rejects bad JSON and bad shapes", () => {
    expect(() => parseEffects("{")).toThrow(/invalid JSON/);
    expect(() => parseEffects("{}")).toThrow(/array/);
    expect(() => parseEffects('[{"type":"extraDrain","track":"gold","perDay":1}]')).toThrow();
    expect(() => parsePrompts('[{"when":{"kind":"day","day":0},"text":"x"}]')).toThrow();
  });
});

describe("drawing geometry", () => {
  it("parses colours", () => {
    expect(colorToNumber("#ff0000")).toBe(0xff0000);
    expect(colorToNumber("#0f0")).toBe(0x00ff00);
    expect(colorToNumber("nope", 7)).toBe(7);
  });

  it("finds a polyline midpoint by length", () => {
    expect(polylineMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }])).toEqual({ x: 10, y: 10 });
    expect(polylineMidpoint([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
  });

  it("makes stars and dashes", () => {
    expect(starPoints(0, 0, 10, 4)).toHaveLength(20);
    const dashes = dashSegments({ x: 0, y: 0 }, { x: 10, y: 0 }, 3, 2);
    expect(dashes[0]).toEqual([0, 0, 3, 0]);
    expect(dashes.at(-1)![2]).toBeLessThanOrEqual(10);
  });

  it("has a palette with a fallback fill", () => {
    expect(TERRAINS.desert.difficulty).toBe("hard");
    expect(terrainFill("salt flat")).toBe("#bbbbbb");
  });
});

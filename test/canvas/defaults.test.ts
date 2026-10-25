// Hex defaults stamped on creation (region defaults, else map defaults, else the brush), re-stamping
// region-less hexes, unnamed route labels, and the tooltip's encounter-mod line.
import { describe, expect, it } from "vitest";
import { applyBrush, hexDefaultsFor, hexInfo, restampUnregioned } from "../../src/canvas/helpers";
import { routeLabel, type HexDefaults, type MapData, type Region } from "../../src/types";

const region = (id: string, defaults?: HexDefaults): Region => ({
  id,
  name: id,
  color: "#7b5ea7",
  encounterTable: null,
  dcMods: {},
  waterMultiplier: 1,
  stormThreshold: null,
  ...(defaults ? { defaults } : {}),
});
const stormDefaults: HexDefaults = { terrain: "badlands", difficulty: "hard", tags: ["hunting-ground"], encounterMod: 2 };
const mapDefaults: HexDefaults = { terrain: "desert", difficulty: "standard", tags: [], encounterMod: 0 };
const brush: HexDefaults = { terrain: "plains", difficulty: "easy", tags: [], encounterMod: 0 };

function base(withMapDefaults = true): MapData {
  return {
    hexes: { "1,1": { key: "1,1", terrain: "oasis", difficulty: "easy", region: null, tags: [] } },
    regions: { storm: region("storm", stormDefaults), plain: region("plain") },
    landmarks: {},
    routes: {},
    ...(withMapDefaults ? { defaults: mapDefaults } : {}),
  };
}
const source = (map: MapData) => (regionId: string | null) => hexDefaultsFor(map, regionId, brush);

describe("stamping new hexes", () => {
  it("a region brush on an empty hex stamps the region's defaults", () => {
    const map = base();
    const out = applyBrush(map, ["0,0"], { kind: "region", regionId: "storm" }, source(map));
    expect(out.hexes["0,0"]).toEqual({ key: "0,0", terrain: "badlands", difficulty: "hard", region: "storm", tags: ["hunting-ground"], encounterMod: 2 });
  });

  it("a region without defaults falls back to the map's, then to the brush", () => {
    const map = base();
    expect(applyBrush(map, ["0,0"], { kind: "region", regionId: "plain" }, source(map)).hexes["0,0"].terrain).toBe("desert");
    const bare = base(false);
    expect(applyBrush(bare, ["0,0"], { kind: "region", regionId: "plain" }, source(bare)).hexes["0,0"].terrain).toBe("plains");
  });

  it("a tag brush on an empty hex stamps the map defaults, then adds the tag", () => {
    const map = base();
    const out = applyBrush(map, ["0,0"], { kind: "tag", tag: "resource", add: true }, source(map));
    expect(out.hexes["0,0"]).toMatchObject({ terrain: "desert", difficulty: "standard", region: null, tags: ["resource"] });
  });

  it("does not re-stamp an existing hex painted into a region", () => {
    const map = base();
    const out = applyBrush(map, ["1,1"], { kind: "region", regionId: "storm" }, source(map));
    expect(out.hexes["1,1"]).toMatchObject({ terrain: "oasis", difficulty: "easy", region: "storm", tags: [] });
  });

  it("the terrain brush sets an encounter mod when given one, and keeps it when blank", () => {
    const map = base();
    const set = applyBrush(map, ["1,1"], { kind: "terrain", terrain: "dunes", difficulty: "hard", encounterMod: 3 }, source(map));
    expect(set.hexes["1,1"].encounterMod).toBe(3);
    const kept = applyBrush(set, ["1,1"], { kind: "terrain", terrain: "dunes", difficulty: "brutal", encounterMod: null }, source(set));
    expect(kept.hexes["1,1"]).toMatchObject({ difficulty: "brutal", encounterMod: 3 });
  });
});

describe("restampUnregioned", () => {
  it("resets only hexes outside a region to the map defaults", () => {
    const map = base();
    map.hexes["2,2"] = { key: "2,2", terrain: "canyon", difficulty: "brutal", region: "storm", tags: [] };
    map.hexes["3,3"] = { key: "3,3", terrain: "water", difficulty: "brutal", region: "gone", tags: ["secret"] }; // region record deleted
    const { map: out, count } = restampUnregioned(map);
    expect(count).toBe(2);
    expect(out.hexes["1,1"]).toMatchObject({ terrain: "desert", difficulty: "standard", tags: [], encounterMod: 0 });
    expect(out.hexes["3,3"]).toMatchObject({ terrain: "desert", tags: [] });
    expect(out.hexes["2,2"].terrain).toBe("canyon");
  });

  it("does nothing without map defaults", () => {
    expect(restampUnregioned(base(false)).count).toBe(0);
  });
});

describe("route labels and tooltip", () => {
  it("falls back to a description for an unnamed route", () => {
    expect(routeLabel({ name: "", days: 3, difficulty: "easy" })).toBe("3-day easy route");
    expect(routeLabel({ name: "  The Glass Meridian ", days: 1, difficulty: "hard" })).toBe("The Glass Meridian");
  });

  it("shows a hex's encounter mod", () => {
    const map = base();
    map.hexes["1,1"].encounterMod = -2;
    expect(hexInfo(map, "1,1", { gm: true })!.lines).toContain("Encounter -2");
  });
});

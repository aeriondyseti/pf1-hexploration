// Hex defaults stamped on creation (region defaults, else map defaults, else the brush), re-stamping
// region-less hexes, and unnamed route labels.
import { describe, expect, it } from "vitest";
import { applyBrush, hexDefaultsFor, restampUnregioned, routeLabel } from "../../src/canvas/helpers";
import type { HexDefaults, MapData, Region } from "../../src/types";

const region = (id: string, defaults?: HexDefaults): Region => ({
  id,
  name: id,
  color: "#7b5ea7",
  encounterTable: null,
  dcMods: {},
  rationsMultiplier: 1,
  waterMultiplier: 1,
  ...(defaults ? { defaults } : {}),
});
const stormDefaults: HexDefaults = { terrain: "desert-rocky", tags: ["hunting-ground"] };
const mapDefaults: HexDefaults = { terrain: "desert-sandy", tags: [] };
const brush: HexDefaults = { terrain: "plains", tags: [] };

function base(withMapDefaults = true): MapData {
  return {
    hexes: { "1,1": { key: "1,1", terrain: "plains", region: null, tags: ["resource"] } },
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
    expect(out.hexes["0,0"]).toEqual({ key: "0,0", terrain: "desert-rocky", region: "storm", tags: ["hunting-ground"] });
  });

  it("a region without defaults falls back to the map's, then to the brush", () => {
    const map = base();
    expect(applyBrush(map, ["0,0"], { kind: "region", regionId: "plain" }, source(map)).hexes["0,0"].terrain).toBe("desert-sandy");
    const bare = base(false);
    expect(applyBrush(bare, ["0,0"], { kind: "region", regionId: "plain" }, source(bare)).hexes["0,0"].terrain).toBe("plains");
  });

  it("a tag brush on an empty hex stamps the map defaults, then adds the element", () => {
    const map = base();
    const out = applyBrush(map, ["0,0"], { kind: "tag", tag: "resource", add: true }, source(map));
    expect(out.hexes["0,0"]).toEqual({ key: "0,0", terrain: "desert-sandy", region: null, tags: ["resource"] });
  });

  it("does not re-stamp an existing hex painted into a region", () => {
    const map = base();
    const out = applyBrush(map, ["1,1"], { kind: "region", regionId: "storm" }, source(map));
    expect(out.hexes["1,1"]).toEqual({ key: "1,1", terrain: "plains", region: "storm", tags: ["resource"] });
  });

  it("the terrain brush sets terrain only", () => {
    const map = base();
    const out = applyBrush(map, ["1,1"], { kind: "terrain", terrain: "jungle" }, source(map));
    expect(out.hexes["1,1"]).toEqual({ key: "1,1", terrain: "jungle", region: null, tags: ["resource"] });
  });
});

describe("restampUnregioned", () => {
  it("resets only hexes outside a region to the map defaults", () => {
    const map = base();
    map.hexes["2,2"] = { key: "2,2", terrain: "mountains", region: "storm", tags: [] };
    map.hexes["3,3"] = { key: "3,3", terrain: "water", region: "gone", tags: ["secret"] }; // region record deleted
    const { map: out, count } = restampUnregioned(map);
    expect(count).toBe(2);
    expect(out.hexes["1,1"]).toMatchObject({ terrain: "desert-sandy", tags: [] });
    expect(out.hexes["3,3"]).toMatchObject({ terrain: "desert-sandy", tags: [] });
    expect(out.hexes["2,2"].terrain).toBe("mountains");
  });

  it("does nothing without map defaults", () => {
    expect(restampUnregioned(base(false)).count).toBe(0);
  });
});

describe("route labels", () => {
  it("falls back to the kind for an unnamed route", () => {
    expect(routeLabel({ name: "", kind: "road" })).toBe("Unnamed road");
    expect(routeLabel({ name: " ", kind: "highway" })).toBe("Unnamed highway");
    expect(routeLabel({ name: "  The Glass Meridian ", kind: "road" })).toBe("The Glass Meridian");
  });
});

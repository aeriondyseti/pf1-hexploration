// The hover tooltip's content: GM detail vs the player view (invariant 1).
import { describe, expect, it } from "vitest";
import { hexInfo } from "../../src/canvas/helpers";
import type { MapData } from "../../src/types";

const map: MapData = {
  hexes: {
    "7,8": { key: "7,8", terrain: "settlement", region: "desert", tags: ["feature"] },
    "7,9": { key: "7,9", terrain: "desert-sandy", region: "storm", tags: ["secret", "hunting-ground"] },
    "8,8": { key: "8,8", terrain: "plains", region: null, tags: [] },
  },
  regions: {
    desert: { id: "desert", name: "The Solaar Desert", color: "#d9b26f", encounterTable: null, dcMods: {}, rationsMultiplier: 1, waterMultiplier: 2 },
    storm: { id: "storm", name: "The Stormlands", color: "#7b5ea7", encounterTable: "RollTable.x", dcMods: { "*": 5 }, rationsMultiplier: 1.5, waterMultiplier: 2 },
  },
  rules: { encounterTable: null, dcMods: {}, rationsMultiplier: 1, waterMultiplier: 1 },
  landmarks: { sw: { id: "sw", name: "Sentinel's Watch", hex: "7,8", description: "", knownToParty: true } },
  routes: {
    gm: { id: "gm", name: "The Glass Meridian", from: "7,8", hexes: ["7,9"], kind: "highway", knownToParty: false },
  },
};

describe("hexInfo", () => {
  it("gives the GM terrain, elements, region rules, routes and party knowledge", () => {
    const info = hexInfo(map, "7,9", { gm: true, knowledge: "explored", tableName: () => "Storm Table" })!;
    expect(info.title).toBe("Desert (sandy)");
    expect(info.lines).toContain("Elements: secret, hunting ground");
    expect(info.lines).toContain("Region: The Stormlands");
    expect(info.lines).toContain("Region rules: table Storm Table · rations ×1.5 · water ×2 · DC all +5");
    expect(info.lines).toContain("Route: The Glass Meridian (highway) · hidden");
    expect(info.lines).toContain("Party knows: explored");
  });

  it("GM sees the map's rules on a region-less hex", () => {
    expect(hexInfo(map, "8,8", { gm: true })!.lines).toContain("Map rules: no encounter table");
  });

  it("shows landmarks and the caravan", () => {
    const info = hexInfo(map, "7,8", { gm: false, caravanHere: true })!;
    expect(info.title).toBe("Settlement");
    expect(info.lines).toContain("Landmark: Sentinel's Watch");
    expect(info.lines).toContain("The caravan is here");
  });

  it("player view: no rules or knowledge line", () => {
    const info = hexInfo(map, "7,8", { gm: false })!;
    expect(info.lines).toContain("Region: The Solaar Desert");
    expect(info.lines.some((l) => l.startsWith("Party knows") || l.includes("rules"))).toBe(false);
  });

  it("returns null for an empty hex (an unknown hex in the player's partyView)", () => {
    const partyView: MapData = { hexes: {}, regions: {}, landmarks: {}, routes: {} };
    expect(hexInfo(partyView, "3,3", { gm: false })).toBeNull();
    expect(hexInfo(map, "0,0", { gm: true })).toBeNull();
  });
});

// The hover tooltip's content: GM detail vs the player view (invariant 1).
import { describe, expect, it } from "vitest";
import { hexInfo } from "../../src/canvas/helpers";
import type { MapData } from "../../src/types";

const map: MapData = {
  hexes: {
    "7,8": { key: "7,8", terrain: "urban", difficulty: "easy", region: "desert", tags: ["feature"] },
    "7,9": { key: "7,9", terrain: "dunes", difficulty: "hard", region: "storm", tags: ["secret"] },
  },
  regions: {
    desert: { id: "desert", name: "The Solaar Desert", color: "#d9b26f", encounterTable: null, dcMods: {}, waterMultiplier: 2, stormThreshold: null },
    storm: { id: "storm", name: "The Stormlands", color: "#7b5ea7", encounterTable: "RollTable.x", dcMods: { "*": 5 }, waterMultiplier: 2, stormThreshold: 30 },
  },
  landmarks: { sw: { id: "sw", name: "Sentinel's Watch", hex: "7,8", description: "", knownToParty: true } },
  routes: {
    gm: { id: "gm", name: "The Glass Meridian", from: "7,8", hexes: ["7,9"], days: 1, difficulty: "hard", encounterBonus: 5, bargain: "", effects: [], prompts: [], knownToParty: false },
  },
};

describe("hexInfo", () => {
  it("gives the GM terrain, region tuning, tags, routes and party knowledge", () => {
    const info = hexInfo(map, "7,9", { gm: true, knowledge: "explored" })!;
    expect(info.title).toBe("Dunes · Hard");
    expect(info.lines).toContain("Region: The Stormlands (DC all +5) · water ×2 · encounter table set");
    expect(info.lines).toContain("Tags: secret");
    expect(info.lines).toContain("Route: The Glass Meridian (1 d, Hard) · hidden");
    expect(info.lines).toContain("Party knows: explored");
  });

  it("shows landmarks and the caravan on the start hex", () => {
    const info = hexInfo(map, "7,8", { gm: false, caravanHere: true })!;
    expect(info.title).toBe("Urban · Easy");
    expect(info.lines.slice(0, 2)).toEqual(["★ Sentinel's Watch", "The caravan is here"]);
  });

  it("player view: no GM tuning or knowledge line", () => {
    const info = hexInfo(map, "7,8", { gm: false })!;
    expect(info.lines).toContain("Region: The Solaar Desert");
    expect(info.lines.some((l) => l.startsWith("Party knows"))).toBe(false);
  });

  it("returns null for an empty hex (an unknown hex in the player's partyView)", () => {
    const partyView: MapData = { hexes: {}, regions: {}, landmarks: {}, routes: {} };
    expect(hexInfo(partyView, "3,3", { gm: false })).toBeNull();
    expect(hexInfo(map, "0,0", { gm: true })).toBeNull();
  });
});

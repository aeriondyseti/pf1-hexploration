// 0.1.x map data migrates to the MVP rework format (DESIGN §4.2).
import { describe, expect, it } from "vitest";
import { MAP_VERSION, migrateMap, migrateTerrain } from "../../src/store/migrate";
import { TERRAIN_KEYS } from "../../src/types";

const oldHex = (key: string, terrain: string, tags: string[] = []) => ({
  key,
  terrain,
  difficulty: "hard",
  region: null,
  tags,
  encounterMod: 2,
});

const oldMap = () => ({
  baseColor: "#123456",
  defaults: { terrain: "canyon", difficulty: "brutal", tags: ["ruins", "secret"], encounterMod: 1 },
  rules: { encounterTable: "RollTable.m", dcMods: { "*": 1 }, waterMultiplier: 3, stormThreshold: 20 },
  hexes: {
    "0,0": oldHex("0,0", "dunes", ["ruins", "feature"]),
    "0,1": oldHex("0,1", "oasis", ["resource"]),
    "0,2": { ...oldHex("0,2", "canyon"), region: "storm" },
  },
  regions: {
    storm: {
      id: "storm", name: "Stormlands", color: "#7b5ea7", encounterTable: "RollTable.s", dcMods: { "*": 5 },
      waterMultiplier: 2, stormThreshold: 30, defaults: { terrain: "badlands", difficulty: "hard", tags: ["hunting-ground", "camp"], encounterMod: 2 },
    },
  },
  landmarks: { sw: { id: "sw", name: "Watch", hex: "0,0", description: "d", knownToParty: true, icon: "fa-eye" } },
  routes: {
    gm: {
      id: "gm", name: "Glass Meridian", from: "0,0", hexes: ["0,1"], color: "#ff0000", days: 3, difficulty: "hard",
      encounterBonus: 5, bargain: "pay", effects: [{ type: "dcMod" }], prompts: [{ text: "x" }], knownToParty: true,
    },
  },
});

describe("migrateTerrain", () => {
  it("maps every 0.1.x label per §4.2", () => {
    const table: Record<string, { terrain: string; tag?: string }> = {
      dunes: { terrain: "desert-sandy" },
      desert: { terrain: "desert-sandy" },
      badlands: { terrain: "desert-rocky" },
      canyon: { terrain: "mountains", tag: "difficult" },
      scrubland: { terrain: "plains" },
      oasis: { terrain: "plains", tag: "resource" },
      marsh: { terrain: "swamp" },
      urban: { terrain: "settlement" },
      road: { terrain: "plains" },
      plains: { terrain: "plains" },
      forest: { terrain: "forest" },
      hills: { terrain: "hills" },
      water: { terrain: "water" },
      mountain: { terrain: "mountains" },
      "salt flat": { terrain: "plains" },
    };
    for (const [old, want] of Object.entries(table)) expect(migrateTerrain(old), old).toEqual(want);
  });

  it("keeps every current terrain key", () => {
    for (const k of TERRAIN_KEYS) expect(migrateTerrain(k)).toEqual({ terrain: k });
    expect(migrateTerrain(undefined)).toEqual({ terrain: "plains" });
  });
});

describe("migrateMap", () => {
  const map = migrateMap(oldMap());

  it("sets the version", () => {
    expect(map.version).toBe(MAP_VERSION);
    expect(MAP_VERSION).toBe(2);
    expect(migrateMap({}).version).toBe(2);
    expect(migrateMap(undefined)).toMatchObject({ hexes: {}, regions: {}, landmarks: {}, routes: {}, version: 2 });
  });

  it("maps terrain, keeps UC tags only, adds implied elements, drops difficulty and encounter mods", () => {
    expect(map.hexes["0,0"]).toEqual({ key: "0,0", terrain: "desert-sandy", region: null, tags: ["feature"] });
    expect(map.hexes["0,1"]).toEqual({ key: "0,1", terrain: "plains", region: null, tags: ["resource"] });
    expect(map.hexes["0,2"]).toEqual({ key: "0,2", terrain: "mountains", region: "storm", tags: ["difficult"] });
  });

  it("migrates regions: drops storm threshold, keeps water and DC mods, rations ×1, defaults mapped", () => {
    expect(map.regions.storm).toEqual({
      id: "storm", name: "Stormlands", color: "#7b5ea7", encounterTable: "RollTable.s", dcMods: { "*": 5 },
      rationsMultiplier: 1, waterMultiplier: 2, defaults: { terrain: "desert-rocky", tags: ["hunting-ground"] },
    });
  });

  it("migrates map defaults and rules", () => {
    expect(map.baseColor).toBe("#123456");
    expect(map.defaults).toEqual({ terrain: "mountains", tags: ["secret", "difficult"] });
    expect(map.rules).toEqual({ encounterTable: "RollTable.m", dcMods: { "*": 1 }, rationsMultiplier: 1, waterMultiplier: 3 });
  });

  it("routes become roads with no days, difficulty, bonus, bargain, effects or prompts", () => {
    expect(map.routes.gm).toEqual({ id: "gm", name: "Glass Meridian", from: "0,0", hexes: ["0,1"], kind: "road", color: "#ff0000", knownToParty: true });
  });

  it("keeps landmarks", () => {
    expect(map.landmarks.sw).toEqual({ id: "sw", name: "Watch", hex: "0,0", description: "d", knownToParty: true, icon: "fa-eye" });
  });

  it("leaves no dropped field anywhere", () => {
    const json = JSON.stringify(map);
    for (const field of ["difficulty", "encounterMod", "stormThreshold", "days", "encounterBonus", "bargain", "effects", "prompts", "ruins", "camp"]) {
      expect(json, field).not.toContain(`"${field}`);
    }
  });

  it("is idempotent on migrated data", () => {
    expect(migrateMap(map)).toEqual(map);
  });
});

// Map symbols: Font Awesome icon names for landmarks and tags, drawn in one colour (region border or dark brown).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANDMARK_ICON,
  DEFAULT_TAG_ICON,
  SYMBOL_COLOR,
  TAG_ICONS,
  iconGlyph,
  landmarkIcon,
  normalizeIcon,
  symbolColor,
  tagIcon,
} from "../../src/canvas/icons";
import { renderMiniMap } from "../../src/ui/minimap";
import type { MapData } from "../../src/types";

describe("normalizeIcon", () => {
  it("accepts fa- names, bare names and full class strings", () => {
    expect(normalizeIcon("fa-water")).toBe("fa-water");
    expect(normalizeIcon("water")).toBe("fa-water");
    expect(normalizeIcon("fa-solid fa-tower-observation")).toBe("fa-tower-observation");
    expect(normalizeIcon("  FA-Paw ")).toBe("fa-paw");
  });

  it("rejects junk and style-only classes", () => {
    expect(normalizeIcon("")).toBeNull();
    expect(normalizeIcon("fa-solid")).toBeNull();
    expect(normalizeIcon("🏰")).toBeNull();
    expect(normalizeIcon("<b>x</b>")).toBeNull();
    expect(normalizeIcon(undefined)).toBeNull();
  });
});

describe("landmark and tag icons", () => {
  it("landmarks use their own icon, else the plain default", () => {
    expect(landmarkIcon({ icon: "fa-tower-observation" })).toBe("fa-tower-observation");
    expect(landmarkIcon({})).toBe(DEFAULT_LANDMARK_ICON);
    expect(landmarkIcon({ icon: "not an icon!" })).toBe(DEFAULT_LANDMARK_ICON);
  });

  it("tags come from one table, overridable, with a default for custom tags", () => {
    expect(tagIcon("hunting-ground")).toBe(TAG_ICONS["hunting-ground"]);
    expect(tagIcon("hunting-ground", { "hunting-ground": "fa-crow" })).toBe("fa-crow");
    expect(tagIcon("ruins")).toBe(DEFAULT_TAG_ICON);
    expect(tagIcon("ruins", { ruins: "fa-dungeon" })).toBe("fa-dungeon");
    expect(Object.values(TAG_ICONS).every((n) => normalizeIcon(n) === n)).toBe(true);
  });
});

describe("symbolColor", () => {
  const map: MapData = {
    hexes: {
      "0,0": { key: "0,0", terrain: "dunes", difficulty: "hard", region: "storm", tags: [] },
      "0,1": { key: "0,1", terrain: "dunes", difficulty: "hard", region: "short", tags: [] },
      "0,2": { key: "0,2", terrain: "dunes", difficulty: "hard", region: null, tags: [] },
    },
    regions: {
      storm: { id: "storm", name: "Storm", color: "#7B5EA780", encounterTable: null, dcMods: {}, waterMultiplier: 1, stormThreshold: null },
      short: { id: "short", name: "Short", color: "#a5c", encounterTable: null, dcMods: {}, waterMultiplier: 1, stormThreshold: null },
    },
    landmarks: {},
    routes: {},
  };

  it("follows the region's border colour, opaque, else dark brown", () => {
    expect(symbolColor(map, "0,0")).toBe("#7b5ea7");
    expect(symbolColor(map, "0,1")).toBe("#aa55cc");
    expect(symbolColor(map, "0,2")).toBe(SYMBOL_COLOR);
    expect(symbolColor(map, "9,9")).toBe(SYMBOL_COLOR);
  });

  it("outside a browser there is no glyph, and the mini-map falls back to a coloured dot", () => {
    expect(iconGlyph("fa-water")).toBeNull();
    map.landmarks.eye = { id: "eye", name: "The Eye", hex: "0,0", description: "", knownToParty: true, icon: "fa-eye" };
    const svg = renderMiniMap(map, { grid: { columns: false, even: false } });
    expect(svg).toContain('class="landmark"');
    expect(svg).toContain("fill:#7b5ea7");
  });
});

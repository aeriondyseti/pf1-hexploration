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
import { UC_TAGS, type MapData } from "../../src/types";

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

  it("each UC element has one built-in icon", () => {
    expect(Object.keys(TAG_ICONS).sort()).toEqual([...UC_TAGS].sort());
    expect(tagIcon("hunting-ground")).toBe(TAG_ICONS["hunting-ground"]);
    expect(tagIcon("ruins")).toBe(DEFAULT_TAG_ICON);
    expect(Object.values(TAG_ICONS).every((n) => normalizeIcon(n) === n)).toBe(true);
  });
});

describe("symbolColor", () => {
  const map: MapData = {
    hexes: {
      "0,0": { key: "0,0", terrain: "desert-sandy", region: "storm", tags: [] },
      "0,1": { key: "0,1", terrain: "desert-sandy", region: "short", tags: [] },
      "0,2": { key: "0,2", terrain: "desert-sandy", region: null, tags: [] },
    },
    regions: {
      storm: { id: "storm", name: "Storm", color: "#7B5EA780", encounterTable: null, dcMods: {}, rationsMultiplier: 1, waterMultiplier: 1 },
      short: { id: "short", name: "Short", color: "#a5c", encounterTable: null, dcMods: {}, rationsMultiplier: 1, waterMultiplier: 1 },
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

  it("outside a browser there is no glyph", () => {
    expect(iconGlyph("fa-water")).toBeNull();
  });
});

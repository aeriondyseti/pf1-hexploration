import { describe, expect, it } from "vitest";
import { hexCenter, renderMiniMap, terrainColor, visiblePath } from "../../src/ui/minimap";
import { esc } from "../../src/ui/html";
import type { LegPlan, MapData } from "../../src/types";

const rows = { columns: false, even: false };
const cols = { columns: true, even: false };

function map(): MapData {
  return {
    hexes: {
      "0,0": { key: "0,0", terrain: "desert", difficulty: "standard", region: "r1", tags: [] },
      "0,1": { key: "0,1", terrain: "dunes", difficulty: "hard", region: "r1", tags: [] },
      "1,0": { key: "1,0", terrain: "<script>", difficulty: "easy", region: null, tags: [] },
    },
    regions: {
      r1: { id: "r1", name: "Waste", color: "#123456", encounterTable: null, dcMods: {}, waterMultiplier: 1, stormThreshold: null },
    },
    landmarks: { l1: { id: "l1", name: "Oasis & Well", hex: "0,1", description: "", knownToParty: true } },
    routes: {
      rt: {
        id: "rt", name: "Long Road", hexes: ["0,1"], from: "0,0", days: 1, difficulty: "standard",
        encounterBonus: 2, bargain: "", effects: [], prompts: [], knownToParty: true,
      },
    },
  };
}

describe("hex geometry", () => {
  it("offsets odd rows on a row-based grid and odd columns on a column-based grid", () => {
    const a = hexCenter("0,0", rows)!;
    const b = hexCenter("1,0", rows)!;
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeGreaterThan(a.y);
    const c = hexCenter("0,1", cols)!;
    expect(c.y).toBeGreaterThan(hexCenter("0,0", cols)!.y);
  });

  it("flips the offset parity on even grids", () => {
    expect(hexCenter("1,0", { columns: false, even: true })!.x).toBe(0);
    expect(hexCenter("0,0", { columns: false, even: true })!.x).toBeGreaterThan(0);
  });

  it("rejects malformed keys", () => {
    expect(hexCenter("nope", rows)).toBeNull();
  });
});

describe("renderMiniMap", () => {
  it("draws every hex, route, landmark and the caravan, escaping text", () => {
    const svg = renderMiniMap(map(), { grid: rows, position: "0,0", legPath: ["0,0", "0,1"], routesClickable: true, selectedRouteId: "rt" });
    expect(svg.match(/<polygon/g)).toHaveLength(3);
    expect(svg).toContain('data-action="pickRoute" data-route-id="rt"');
    expect(svg).toContain('class="route selected"');
    expect(svg).toContain("leg-path");
    expect(svg).toContain("Oasis &amp; Well");
    expect(svg).toContain('class="caravan"');
    expect(svg).not.toContain("<script>");
  });

  it("does not make routes clickable unless asked", () => {
    expect(renderMiniMap(map(), { grid: rows })).not.toContain("data-action");
  });

  it("renders an empty-state message for an empty map", () => {
    expect(renderMiniMap({ hexes: {}, regions: {}, landmarks: {}, routes: {} }, { grid: rows })).toContain("No mapped hexes");
  });
});

describe("visiblePath", () => {
  it("keeps only hexes the given map contains", () => {
    const plan = { from: "0,0", path: ["0,1", "5,5"] } as LegPlan;
    expect(visiblePath(plan, map())).toEqual(["0,0", "0,1"]);
    expect(visiblePath(null, map())).toEqual([]);
  });
});

describe("helpers", () => {
  it("colours known terrain from the palette, else the region, else a stable hash", () => {
    expect(terrainColor("Desert")).toBe("#ead5a3"); // canvas palette
    expect(terrainColor("tundra")).toBe("#cfd8dc"); // local fallback palette
    expect(terrainColor("weird", "#abcdef")).toBe("#abcdef");
    expect(terrainColor("weird")).toBe(terrainColor("weird"));
  });

  it("escapes HTML", () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

// Edge-by-edge hex borders. The helper works on any polygon grid, so these tests use 10px square cells:
// key "i,j" is the cell at row i, column j; the shared edge of "0,0" and "0,1" is the line x = 10.
import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_COLOR, borderSegments } from "../../src/canvas/helpers";
import type { HexRecord, MapData, Region } from "../../src/types";

const S = 10;
const geometry = {
  verticesOf: (key: string) => {
    const [i, j] = key.split(",").map(Number);
    return [
      { x: j * S, y: i * S },
      { x: (j + 1) * S, y: i * S },
      { x: (j + 1) * S, y: (i + 1) * S },
      { x: j * S, y: (i + 1) * S },
    ];
  },
  centerOf: (key: string) => {
    const [i, j] = key.split(",").map(Number);
    return { x: (j + 0.5) * S, y: (i + 0.5) * S };
  },
  neighbourAt: (p: { x: number; y: number }) => `${Math.floor(p.y / S)},${Math.floor(p.x / S)}`,
};

const hex = (key: string, region: string | null = null): HexRecord => ({ key, terrain: "dunes", difficulty: "easy", region, tags: [] });
const region = (id: string, color: string): Region => ({ id, name: id, color, encounterTable: null, dcMods: {}, waterMultiplier: 1, stormThreshold: null });
const mapOf = (hexes: HexRecord[], regions: Region[] = [], baseColor?: string): MapData => ({
  baseColor,
  hexes: Object.fromEntries(hexes.map((h) => [h.key, h])),
  regions: Object.fromEntries(regions.map((r) => [r.id, r])),
  landmarks: {},
  routes: {},
});
// Segments lying on the shared edge x = 10 (or inset just beside it).
const sharedEdge = (segs: ReturnType<typeof borderSegments>) => segs.filter((s) => Math.abs(s.x1 - 10) < 3 && Math.abs(s.x2 - 10) < 3);

describe("borderSegments", () => {
  it("draws region-less hexes in the default grey, each shared edge once", () => {
    const segs = borderSegments(mapOf([hex("0,0"), hex("0,1")]), geometry, 1);
    expect(segs).toHaveLength(7); // 4 + 4 edges, minus the one they share
    expect(segs.every((s) => s.kind === "base" && s.color === DEFAULT_BASE_COLOR)).toBe(true);
    expect(sharedEdge(segs)).toHaveLength(1);
  });

  it("uses the map's own border colour", () => {
    const segs = borderSegments(mapOf([hex("0,0")], [], "#123456"), geometry, 1);
    expect(segs.map((s) => s.color)).toEqual(["#123456", "#123456", "#123456", "#123456"]);
  });

  it("gives a region hex its colour on every side, winning over a region-less neighbour", () => {
    const segs = borderSegments(mapOf([hex("0,0", "red"), hex("0,1")], [region("red", "#ff0000")]), geometry, 1);
    const shared = sharedEdge(segs);
    expect(shared).toEqual([expect.objectContaining({ color: "#ff0000", kind: "region", x1: 10, x2: 10 })]);
    expect(segs.filter((s) => s.color === "#ff0000")).toHaveLength(4);
    expect(segs.filter((s) => s.kind === "base")).toHaveLength(3); // the plain hex's other three sides
  });

  it("draws one line inside a single region", () => {
    const segs = borderSegments(mapOf([hex("0,0", "red"), hex("0,1", "red")], [region("red", "#ff0000")]), geometry, 1);
    expect(segs).toHaveLength(7);
    expect(sharedEdge(segs)).toHaveLength(1);
  });

  it("draws a double line where two regions meet, each colour inset into its own hex", () => {
    const segs = borderSegments(
      mapOf([hex("0,0", "red"), hex("0,1", "blue")], [region("red", "#ff0000"), region("blue", "#0000ff")]),
      geometry,
      1.5,
    );
    const shared = sharedEdge(segs);
    expect(shared).toHaveLength(2);
    expect(shared.every((s) => s.kind === "double")).toBe(true);
    const red = shared.find((s) => s.color === "#ff0000")!;
    const blue = shared.find((s) => s.color === "#0000ff")!;
    expect(red.x1).toBeLessThan(10); // inset toward the red hex (left)
    expect(blue.x1).toBeGreaterThan(10); // inset toward the blue hex (right)
  });

  it("treats a region id with no region record as region-less", () => {
    const segs = borderSegments(mapOf([hex("0,0", "ghost")]), geometry, 1);
    expect(segs.every((s) => s.kind === "base")).toBe(true);
  });
});

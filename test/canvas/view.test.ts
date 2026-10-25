// Per-user view options: saved switches merge over the all-on defaults; bad or unknown data falls back safely.
import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, VIEW_ROWS, parseView } from "../../src/canvas/view";

describe("parseView", () => {
  it("starts with everything on", () => {
    expect(parseView("")).toEqual(DEFAULT_VIEW);
    expect(Object.values(DEFAULT_VIEW).every(Boolean)).toBe(true);
  });

  it("keeps saved switches and fills the rest from the defaults", () => {
    const view = parseView(JSON.stringify({ terrain: false, routeNames: false }));
    expect(view).toEqual({ ...DEFAULT_VIEW, terrain: false, routeNames: false });
  });

  it("ignores junk, non-boolean values and unknown keys", () => {
    expect(parseView("{not json")).toEqual(DEFAULT_VIEW);
    expect(parseView(JSON.stringify({ borders: "no", ghosts: false }))).toEqual(DEFAULT_VIEW);
    expect(parseView(42)).toEqual(DEFAULT_VIEW);
  });

  it("has a panel row for every switch, with hidden routes GM-only", () => {
    expect(VIEW_ROWS.map((r) => r.key).sort()).toEqual(Object.keys(DEFAULT_VIEW).sort());
    expect(VIEW_ROWS.filter((r) => r.gmOnly).map((r) => r.key)).toEqual(["hiddenRoutes"]);
  });
});

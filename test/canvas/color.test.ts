// Colours with an alpha channel: "#rgb", "#rgba", "#rrggbb", "#rrggbbaa"; the painter's picker + opacity round-trip.
import { describe, expect, it } from "vitest";
import { colorAlpha, colorToNumber, joinColor, parseColor, splitColor } from "../../src/canvas/helpers";

describe("parseColor", () => {
  it("reads 3, 4, 6 and 8 digit hex", () => {
    expect(parseColor("#abc")).toEqual({ rgb: 0xaabbcc, alpha: 1 });
    expect(parseColor("#abc8")).toEqual({ rgb: 0xaabbcc, alpha: 0x88 / 255 });
    expect(parseColor("#7b5ea7")).toEqual({ rgb: 0x7b5ea7, alpha: 1 });
    expect(parseColor("#7b5ea780")).toEqual({ rgb: 0x7b5ea7, alpha: 0x80 / 255 });
  });

  it("falls back, opaque, for anything else", () => {
    expect(parseColor("red", 0x123456)).toEqual({ rgb: 0x123456, alpha: 1 });
    expect(parseColor(undefined)).toEqual({ rgb: 0x888888, alpha: 1 });
    expect(colorToNumber("#7b5ea780")).toBe(0x7b5ea7); // used to fall back to grey
    expect(colorAlpha("#00000000")).toBe(0);
  });
});

describe("splitColor / joinColor", () => {
  it("splits into a picker value and an opacity, and joins back", () => {
    expect(splitColor("#7b5ea780")).toEqual({ hex: "#7b5ea7", alpha: 0x80 / 255 });
    expect(splitColor("", "#cc3333")).toEqual({ hex: "#cc3333", alpha: 1 });
    expect(joinColor("#7b5ea7", 1)).toBe("#7b5ea7"); // opaque stays 6-digit
    expect(joinColor("#7b5ea7", 0.5)).toBe("#7b5ea780");
    expect(joinColor("#7b5ea7", 0)).toBe("#7b5ea700");
    expect(joinColor("#7b5ea7", 7)).toBe("#7b5ea7"); // clamped
  });

  it("round-trips through the painter's 0-100 opacity slider", () => {
    for (const color of ["#cc3333", "#cc333380", "#00ff0033"]) {
      const { hex, alpha } = splitColor(color);
      const slider = Math.round(alpha * 100);
      expect(parseColor(joinColor(hex, slider / 100)).alpha).toBeCloseTo(alpha, 1);
    }
  });
});

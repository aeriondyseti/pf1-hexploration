// Map symbols as Font Awesome icons: landmark icons, the tag icon table, and the colour symbols are drawn in.
// Icons are named like "fa-water". On the canvas (and in the mini-map) each icon is drawn as its Font Awesome
// glyph in a single colour: the hex's region border colour, else dark brown. No emoji, no pre-coloured symbols.
import type { Landmark, MapData } from "../types";

/** Plain default for landmarks that don't set an icon. */
export const DEFAULT_LANDMARK_ICON = "fa-location-dot";
/** Fallback for a tag outside the table (should not happen after migration). */
export const DEFAULT_TAG_ICON = "fa-tag";
/** Symbol colour on hexes outside any region. */
export const SYMBOL_COLOR = "#5a3a1a";

/** One built-in icon per UC terrain element. */
export const TAG_ICONS: Record<string, string> = {
  difficult: "fa-triangle-exclamation",
  feature: "fa-star",
  "hunting-ground": "fa-paw",
  resource: "fa-seedling",
  secret: "fa-eye-slash",
  standard: "fa-square",
};

const STYLE_CLASSES = new Set(["fa-solid", "fa-regular", "fa-light", "fa-thin", "fa-duotone", "fa-brands", "fa-sharp", "fa-fw"]);

/**
 * Normalise an icon name to "fa-<name>": accepts "fa-water", "water" or "fa-solid fa-water".
 * Returns null for anything that isn't an icon name.
 */
export function normalizeIcon(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const tokens = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (let n = tokens.length - 1; n >= 0; n--) {
    // A bare name ("water") is only accepted on its own; in a class string, only real "fa-" tokens count.
    if (tokens.length > 1 && !tokens[n].startsWith("fa-")) continue;
    const t = tokens[n].startsWith("fa-") ? tokens[n] : `fa-${tokens[n]}`;
    if (STYLE_CLASSES.has(t)) continue;
    if (/^fa-[a-z0-9]+(-[a-z0-9]+)*$/.test(t)) return t;
  }
  return null;
}

export function landmarkIcon(lm: Pick<Landmark, "icon">): string {
  return normalizeIcon(lm.icon) ?? DEFAULT_LANDMARK_ICON;
}

export function tagIcon(tag: string): string {
  return TAG_ICONS[tag] ?? DEFAULT_TAG_ICON;
}

/** A symbol's colour on a hex: its region's border colour (opaque), else dark brown. */
export function symbolColor(map: MapData, key: string): string {
  const id = map.hexes[key]?.region;
  const color = id ? map.regions[id]?.color : undefined;
  const hex = /^#?([0-9a-f]{6})/i.exec((color ?? "").trim())?.[1];
  if (hex) return `#${hex.toLowerCase()}`;
  const short = /^#?([0-9a-f]{3})[0-9a-f]?$/i.exec((color ?? "").trim())?.[1];
  return short ? `#${[...short].map((c) => c + c).join("").toLowerCase()}` : SYMBOL_COLOR;
}

export interface Glyph {
  char: string;
  fontFamily: string;
  fontWeight: string;
}

const glyphs = new Map<string, Glyph | null>();

/**
 * The Font Awesome glyph for an icon name, read from the font Foundry already loads (via the icon's CSS
 * `::before` content). Null outside a browser or for a name Font Awesome doesn't know. Cached.
 */
export function iconGlyph(name: string): Glyph | null {
  if (glyphs.has(name)) return glyphs.get(name)!;
  let glyph: Glyph | null = null;
  try {
    if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
      const el = document.createElement("i");
      el.className = `fa-solid ${name}`;
      el.style.position = "absolute";
      el.style.visibility = "hidden";
      document.body.appendChild(el);
      const before = getComputedStyle(el, "::before");
      const content = before.content.replace(/^["']|["']$/g, "");
      if (content && content !== "none" && content !== "normal") {
        glyph = { char: content, fontFamily: before.fontFamily || getComputedStyle(el).fontFamily, fontWeight: before.fontWeight || "900" };
      }
      el.remove();
    }
  } catch {
    glyph = null;
  }
  glyphs.set(name, glyph);
  return glyph;
}

/** The glyph for an icon, falling back to `fallback`'s glyph when Font Awesome doesn't know the name. */
export function glyphOr(name: string, fallback: string): Glyph | null {
  return iconGlyph(name) ?? iconGlyph(fallback);
}

// The hex terrain layer. It lives in canvas.primary just above the scene background and below
// tiles and tokens (primary sorts by elevation, then sortLayer), so fills never tint tokens.
// Players draw only store.partyView() (invariant 1); the GM draws the full map.
import { store } from "../store";
import type { HexKey, MapData } from "../types";
import { MODULE_ID } from "../types";
import {
  DIFFICULTY_LETTER,
  TAG_GLYPH,
  colorToNumber,
  dashSegments,
  parseHexKey,
  polylineMidpoint,
  starPoints,
} from "./helpers";
import { draft } from "./state";
import { terrainFill } from "./terrain";

let container: any = null;

const FILL_ALPHA = 0.55;
const LABEL_FONT = "Signika, sans-serif";

function center(key: HexKey): { x: number; y: number } {
  return canvas.grid.getCenterPoint(parseHexKey(key));
}

function vertices(key: HexKey): number[] {
  return canvas.grid.getVertices(parseHexKey(key)).flatMap((p: any) => [p.x, p.y]);
}

function text(str: string, size: number, color = 0x111111): any {
  const t = new PIXI.Text(str, {
    fontFamily: LABEL_FONT,
    fontSize: size,
    fill: color,
    stroke: 0xffffff,
    strokeThickness: Math.max(2, size / 5),
    align: "center",
  });
  t.anchor.set(0.5);
  return t;
}

function ensureContainer(): any {
  if (container && !container.destroyed) return container;
  container = new PIXI.Container();
  container.name = `${MODULE_ID}-layer`;
  container.eventMode = "none"; // purely visual; never steal clicks from tokens
  container.elevation = 0;
  container.sortLayer = 1; // above SCENE (0), below TILES (500) and TOKENS (700)
  container.sort = 0;
  canvas.primary.addChild(container);
  return container;
}

export function teardownLayer(): void {
  if (container && !container.destroyed) container.destroy({ children: true });
  container = null;
}

export function drawLayer(): void {
  if (!canvas?.ready || !canvas.grid || !canvas.primary) return;
  const root = ensureContainer();
  for (const child of root.removeChildren()) child.destroy({ children: true });

  const gm = !!game.user?.isGM;
  // Battlemaps and other non-hex scenes: draw nothing (the scene controls hide our tools there).
  if (!canvas.grid.isHexagonal) return;

  const map: MapData = gm ? draft.working ?? store.getMap() : store.partyView();
  const knowledge = gm ? store.getPartyMap().knowledge : {};
  const size = canvas.grid.size;

  drawHexes(root, map, knowledge, gm, size);
  drawRoutes(root, map, size);
  drawLeg(root, map, size);
  if (gm) drawDrafts(root, size);
  drawLandmarks(root, map, size);
}

function drawHexes(root: any, map: MapData, knowledge: Record<HexKey, string>, gm: boolean, size: number): void {
  const fills = new PIXI.Graphics();
  const outlines = new PIXI.Graphics();
  const labels = new PIXI.Container();
  root.addChild(fills, outlines, labels);

  for (const hex of Object.values(map.hexes)) {
    const poly = vertices(hex.key);
    fills.beginFill(colorToNumber(terrainFill(hex.terrain)), FILL_ALPHA);
    fills.drawPolygon(poly);
    fills.endFill();

    const region = hex.region ? map.regions[hex.region] : null;
    if (region) {
      outlines.lineStyle(Math.max(2, size / 25), colorToNumber(region.color), 0.9);
      outlines.drawPolygon(poly);
    }

    // GM aid: hexes the party has not explored get a dashed dark outline.
    if (gm && (knowledge[hex.key] ?? "unknown") === "unknown") {
      outlines.lineStyle(Math.max(1, size / 50), 0x222222, 0.8);
      const pts = canvas.grid.getVertices(parseHexKey(hex.key));
      for (let n = 0; n < pts.length; n++) {
        for (const [x1, y1, x2, y2] of dashSegments(pts[n], pts[(n + 1) % pts.length], size / 10, size / 14)) {
          outlines.moveTo(x1, y1);
          outlines.lineTo(x2, y2);
        }
      }
    }

    const c = center(hex.key);
    const letter = text(DIFFICULTY_LETTER[hex.difficulty] ?? "?", size / 6, 0x333333);
    letter.position.set(c.x, c.y - size * 0.3);
    labels.addChild(letter);

    if (hex.tags.length) {
      const glyphs = hex.tags.map((t) => TAG_GLYPH[t] ?? "+").join(" ");
      const tags = text(glyphs, size / 8, 0x553311);
      tags.position.set(c.x, c.y - size * 0.12);
      labels.addChild(tags);
    }
  }
}

function drawPolyline(g: any, keys: HexKey[]): { x: number; y: number }[] {
  const pts = keys.map(center);
  pts.forEach((p, n) => (n ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  return pts;
}

function drawRoutes(root: any, map: MapData, size: number): void {
  const g = new PIXI.Graphics();
  root.addChild(g);
  for (const route of Object.values(map.routes)) {
    g.lineStyle(Math.max(2, size / 16), 0x7a3b10, 0.85);
    const pts = drawPolyline(g, [route.from, ...route.hexes]);
    const mid = polylineMidpoint(pts);
    const label = text(route.name, size / 5, 0x5a2a08);
    label.position.set(mid.x, mid.y - size * 0.12);
    root.addChild(label);
  }
}

// `map` is the party view for players, so the leg is cut to hexes they know (invariant 1).
function drawLeg(root: any, map: MapData, size: number): void {
  const leg = store.getCaravan().leg;
  if (!leg || leg.status === "arrived" || !leg.plan.path.length) return;
  const keys = [leg.plan.from, ...leg.plan.path].filter((k) => !!map.hexes[k]);
  if (keys.length < 2) return;
  const g = new PIXI.Graphics();
  g.lineStyle(Math.max(4, size / 8), 0xffc400, 0.8);
  drawPolyline(g, keys);
  root.addChild(g);
}

function drawDrafts(root: any, size: number): void {
  const g = new PIXI.Graphics();
  root.addChild(g);
  const r = draft.route;
  if (r?.from) {
    g.lineStyle(Math.max(3, size / 12), 0x00a0c0, 0.9);
    drawPolyline(g, [r.from, ...r.hexes]);
    const c = center(r.from);
    g.beginFill(0x00a0c0, 0.9).drawCircle(c.x, c.y, size / 10).endFill();
  }
  const p = draft.plotted;
  if (p.from) {
    g.lineStyle(Math.max(3, size / 12), 0xc000c0, 0.9);
    drawPolyline(g, [p.from, ...p.path]);
    const c = center(p.from);
    g.beginFill(0xc000c0, 0.9).drawCircle(c.x, c.y, size / 10).endFill();
  }
  if (draft.stroke.length) {
    g.lineStyle(Math.max(2, size / 20), 0xffffff, 0.9);
    for (const key of draft.stroke) g.drawPolygon(vertices(key));
  }
}

function drawLandmarks(root: any, map: MapData, size: number): void {
  const g = new PIXI.Graphics();
  root.addChild(g);
  for (const lm of Object.values(map.landmarks)) {
    const c = center(lm.hex);
    g.lineStyle(1, 0x000000, 0.9);
    g.beginFill(lm.knownToParty ? 0xffd700 : 0xb0b0b0, 1);
    g.drawPolygon(starPoints(c.x, c.y, size / 6, size / 14));
    g.endFill();
    const label = text(lm.name, size / 5, 0x000000);
    label.position.set(c.x, c.y + size * 0.25);
    root.addChild(label);
  }
}

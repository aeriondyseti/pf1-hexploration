// Terrain palette (light fills) for the §4.2 terrain list. Labels come from TERRAIN_RULES.
import { TERRAIN_KEYS, TERRAIN_RULES, type Terrain } from "../types";

export interface TerrainDef {
  label: string;
  fill: string;
}

const FILLS: Record<Terrain, string> = {
  "desert-sandy": "#f0dca8",
  "desert-rocky": "#c89878",
  forest: "#c6d8a0",
  hills: "#dcc89a",
  jungle: "#8fbf7a",
  moor: "#b8b48c",
  mountains: "#c4bcae",
  plains: "#ede3c6",
  swamp: "#a6c1c0",
  tundra: "#e4ecf0",
  settlement: "#c4b0a0",
  water: "#a6c1e0",
};

export const TERRAINS: Record<string, TerrainDef> = Object.fromEntries(
  TERRAIN_KEYS.map((k) => [k, { label: TERRAIN_RULES[k].label, fill: FILLS[k] }]),
);

export { TERRAIN_KEYS };

/** Fill for any terrain key; an unknown key gets a neutral grey. */
export function terrainFill(terrain: string): string {
  return TERRAINS[terrain]?.fill ?? "#bbbbbb";
}

export function terrainLabel(terrain: string): string {
  return TERRAINS[terrain]?.label ?? terrain;
}

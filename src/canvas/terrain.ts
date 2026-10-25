// Terrain palette, ported from the owner's earlier hexploration project (light fills).
import type { Difficulty } from "../types";

export interface TerrainDef {
  label: string;
  fill: string;
  difficulty: Difficulty;
}

export const TERRAINS: Record<string, TerrainDef> = {
  plains: { label: "Plains", fill: "#ede3c6", difficulty: "easy" },
  forest: { label: "Forest", fill: "#c6d8a0", difficulty: "standard" },
  hills: { label: "Hills", fill: "#dcc89a", difficulty: "standard" },
  mountain: { label: "Mountain", fill: "#c4bcae", difficulty: "hard" },
  marsh: { label: "Marsh", fill: "#a6c1c0", difficulty: "hard" },
  desert: { label: "Desert", fill: "#ead5a3", difficulty: "hard" },
  dunes: { label: "Dunes", fill: "#f0dca8", difficulty: "hard" },
  scrubland: { label: "Scrubland", fill: "#d4ca94", difficulty: "standard" },
  badlands: { label: "Badlands", fill: "#c89878", difficulty: "hard" },
  canyon: { label: "Canyon", fill: "#b07556", difficulty: "brutal" },
  oasis: { label: "Oasis", fill: "#a8cba0", difficulty: "easy" },
  water: { label: "Water", fill: "#a6c1e0", difficulty: "brutal" },
  road: { label: "Road", fill: "#c9b68a", difficulty: "easy" },
  urban: { label: "Urban", fill: "#c4b0a0", difficulty: "easy" },
};

export const TERRAIN_KEYS = Object.keys(TERRAINS);

/** Fill for any terrain label; unknown (custom or imported) labels get a neutral grey. */
export function terrainFill(terrain: string): string {
  return TERRAINS[terrain]?.fill ?? "#bbbbbb";
}

export function terrainLabel(terrain: string): string {
  return TERRAINS[terrain]?.label ?? terrain;
}

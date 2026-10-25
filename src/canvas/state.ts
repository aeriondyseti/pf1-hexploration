// Client-local drafting state shared by the painter and the layer (GM client only; never stored).
import type { HexKey, MapData } from "../types";

export const draft = {
  /** In-progress brush stroke applied to a copy of the map, for live preview before the single write. */
  working: null as MapData | null,
  /** Hexes touched by the current stroke (highlighted; used by the knowledge brush). */
  stroke: [] as HexKey[],
  /** Route being drawn or edited. */
  route: null as { id: string | null; from: HexKey | null; hexes: HexKey[] } | null,
  /** Off-route path plotted with the Path tool. */
  plotted: { from: null as HexKey | null, path: [] as HexKey[] },
};

export function notify(level: "info" | "warn" | "error", message: string): void {
  (globalThis as any).ui?.notifications?.[level](message);
}

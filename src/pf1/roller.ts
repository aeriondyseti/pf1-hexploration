import type { Roller } from "../contracts";

/** Dice for live play: Foundry's dice when available, Math.random otherwise. */
function roll(sides: number): number {
  try {
    const total = new Roll(`1d${sides}`).evaluateSync().total;
    if (Number.isInteger(total) && total >= 1 && total <= sides) return total;
  } catch {
    // fall through
  }
  return Math.floor(Math.random() * sides) + 1;
}

export const foundryRoller: Roller = {
  d20: () => roll(20),
  die: (sides: number) => roll(sides),
};

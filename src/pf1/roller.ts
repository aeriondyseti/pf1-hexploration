import type { Roller } from "../contracts";

/** d20 roller for live play: Foundry's dice when available, Math.random otherwise. */
export const foundryRoller: Roller = {
  d20() {
    try {
      const total = new Roll("1d20").evaluateSync().total;
      if (Number.isInteger(total) && total >= 1 && total <= 20) return total;
    } catch {
      // fall through
    }
    return Math.floor(Math.random() * 20) + 1;
  },
};

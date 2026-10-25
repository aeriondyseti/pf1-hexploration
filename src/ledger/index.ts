// Ledger: every automated change as an undoable entry, kept on the caravan actor (invariant 4).
import type { LedgerApi } from "../contracts";
import { pf1Adapter } from "../pf1";
import { store } from "../store";
import { MODULE_ID, type Change, type LedgerEntry } from "../types";

const LEDGER_CAP = 100;

function requireGM(): void {
  if (!game.user?.isGM) throw new Error("GM only");
}

function caravanActor(): any {
  const actor = store.getCaravanActor();
  if (!actor) throw new Error("No caravan actor");
  return actor;
}

function readEntries(): LedgerEntry[] {
  const raw = store.getCaravanActor()?.getFlag(MODULE_ID, "ledger");
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeEntries(entries: LedgerEntry[]): Promise<void> {
  await caravanActor().setFlag(MODULE_ID, "ledger", JSON.stringify(entries.slice(-LEDGER_CAP)));
}

async function revert(change: Change): Promise<void> {
  switch (change.kind) {
    case "itemQuantity":
      if (change.containerUuid) {
        await fromUuidSync(change.containerUuid)?.updateContainerContents([{ _id: change.itemId, "system.quantity": change.before }]);
      } else {
        await fromUuidSync(change.itemUuid)?.update({ "system.quantity": change.before });
      }
      break;
    case "condition": {
      const actor = fromUuidSync(change.actorUuid);
      if (actor) await pf1Adapter.setCondition(actor, change.condition, change.before);
      break;
    }
    case "knowledge":
      await store.setKnowledge(change.sceneId, [change.key], change.before);
      break;
    case "caravan":
      await store.setCaravan(change.before);
      break;
    case "token":
      await fromUuidSync(change.tokenUuid)?.update(change.before);
      break;
    case "worldTime":
      await game.time.advance(-change.seconds);
      break;
  }
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const ledger = {
  async record(label: string, changes: Change[]): Promise<LedgerEntry> {
    requireGM();
    const entry: LedgerEntry = { id: newId(), label, changes };
    await writeEntries([...readEntries(), entry]);
    store.notify();
    return entry;
  },

  async undoLast(): Promise<LedgerEntry | null> {
    requireGM();
    const entries = readEntries();
    const entry = entries.at(-1);
    if (!entry) return null;
    for (const change of [...entry.changes].reverse()) await revert(change);
    await writeEntries(entries.slice(0, -1));
    store.notify();
    return entry;
  },

  entries(): LedgerEntry[] {
    return readEntries();
  },
} satisfies LedgerApi;

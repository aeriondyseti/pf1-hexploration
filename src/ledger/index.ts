// Undo of the last day step (invariant 4, ADR-0008): a snapshot of everything a day changes, kept on the
// caravan actor. Each day's snapshot replaces the previous one, so only the last day can be undone.
import type { UndoApi } from "../contracts";
import { pf1Adapter } from "../pf1";
import { store } from "../store";
import { MODULE_ID, type CaravanState, type PartyMap } from "../types";

interface Snapshot {
  label: string;
  caravan: CaravanState;
  supplies: { itemUuid: string; containerUuid: string | null; itemId: string; quantity: number }[];
  vehicles: { actorUuid: string; hp: number }[];
  sceneId: string | null;
  party: PartyMap | null;
  token: { uuid: string; x: number; y: number } | null;
  seconds: number;
  fundsAfter: number | null; // party funds when the day finished (undo restores the day's change only)
}

const FLAG = "lastDay";

function requireGM(): void {
  if (!game.user?.isGM) throw new Error("GM only");
}

function read(): Snapshot | null {
  const raw = store.getCaravanActor()?.getFlag(MODULE_ID, FLAG);
  if (typeof raw !== "string" || raw === "") return null;
  try {
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

async function write(snap: Snapshot | null): Promise<void> {
  const actor = store.getCaravanActor();
  if (!actor) throw new Error("No caravan actor");
  await actor.setFlag(MODULE_ID, FLAG, snap ? JSON.stringify(snap) : "");
}

function caravanToken(sceneId: string | null): any | null {
  const actor = store.getCaravanActor();
  const scene = sceneId ? game.scenes?.get(sceneId) : canvas?.scene;
  if (!actor || !scene) return null;
  return Array.from<any>(scene.tokens ?? []).find((t) => t.actorId === actor.id) ?? null;
}

export const undo = {
  async capture(label: string) {
    requireGM();
    const caravan = store.getCaravan();
    const token = caravanToken(caravan.sceneId);
    const snap: Snapshot = {
      label,
      caravan: structuredClone(caravan),
      supplies: [...store.supplyItems(), ...store.repairItems()].map((s) => ({
        itemUuid: s.item.uuid ?? "",
        containerUuid: s.container?.uuid ?? null,
        itemId: s.item.id,
        quantity: Number(s.item.system?.quantity ?? 0),
      })),
      vehicles: caravan.vehicles.map((v) => {
        const a = fromUuidSync(v.actorUuid);
        return { actorUuid: v.actorUuid, hp: a ? pf1Adapter.vehicleHp(a).hp : 0 };
      }),
      sceneId: caravan.sceneId,
      party: caravan.sceneId ? store.getPartyMap(caravan.sceneId) : null,
      token: token ? { uuid: token.uuid, x: token.x, y: token.y } : null,
      seconds: 0,
      fundsAfter: null,
    };
    await write(snap);
  },

  async recordTime(seconds: number, fundsAfter: number) {
    const snap = read();
    if (!snap) return;
    snap.seconds += seconds;
    snap.fundsAfter = fundsAfter;
    await write(snap);
  },

  async undo(): Promise<string | null> {
    requireGM();
    const snap = read();
    if (!snap) return null;
    for (const s of snap.supplies) {
      if (s.containerUuid) {
        await fromUuidSync(s.containerUuid)?.updateContainerContents?.([{ _id: s.itemId, "system.quantity": s.quantity }]);
      } else {
        await fromUuidSync(s.itemUuid)?.update?.({ "system.quantity": s.quantity });
      }
    }
    for (const v of snap.vehicles) {
      const a = fromUuidSync(v.actorUuid);
      if (a) await pf1Adapter.setVehicleHp(a, v.hp);
    }
    if (snap.sceneId && snap.party) await store.setPartyMap(snap.sceneId, snap.party);
    if (snap.token) await fromUuidSync(snap.token.uuid)?.update?.({ x: snap.token.x, y: snap.token.y });
    if (snap.seconds) await game.time.advance(-snap.seconds);
    // Restore only what the day changed: roster, roles and plan edits made since then stay; funds get the
    // day's own change (wages, repairs) back, so deposits and withdrawals made since are kept.
    const now = store.getCaravan();
    const dayDelta = snap.fundsAfter === null ? 0 : snap.caravan.funds - snap.fundsAfter;
    await store.setCaravan({
      ...now,
      position: snap.caravan.position,
      sceneId: snap.caravan.sceneId,
      journeyDay: snap.caravan.journeyDay,
      trip: snap.caravan.trip,
      funds: now.funds + dayDelta,
    });
    await write(null);
    store.notify();
    return snap.label;
  },

  available(): string | null {
    return read()?.label ?? null;
  },
} satisfies UndoApi;

// Builds the engine's DayContext from the caravan, its linked actors and the map (DESIGN §4.5–§4.11).
import { engine } from "../engine";
import { pf1Adapter } from "../pf1";
import { store } from "../store";
import type { CaravanState, DayContext, MapData, Pace, PartyMap, VehicleInfo, WalkerInfo } from "../types";

function actor(uuid: string | null | undefined): any | null {
  if (!uuid) return null;
  try {
    return fromUuidSync(uuid) ?? null;
  } catch {
    return null;
  }
}

/** Actor UUID -> roles held, driving included (doubling: DESIGN §4.5). */
export function rolesHeld(c: CaravanState): Record<string, number> {
  const held: Record<string, number> = {};
  const add = (uuid: string | null | undefined) => {
    if (uuid) held[uuid] = (held[uuid] ?? 0) + 1;
  };
  for (const uuid of Object.values(c.roles)) add(uuid);
  for (const v of c.vehicles) add(v.driver);
  return held;
}

/** Travellers not riding, driving or pulling: they walk and their speed counts toward pace. */
export function walkerUuids(c: CaravanState): string[] {
  const busy = new Set<string>();
  for (const v of c.vehicles) {
    if (v.driver) busy.add(v.driver);
    for (const t of v.team) busy.add(t);
  }
  const vehicleIds = new Set(c.vehicles.map((v) => v.actorUuid));
  return c.travellers
    .filter((t) => !busy.has(t.actorUuid) && !(t.seat && vehicleIds.has(t.seat)))
    .map((t) => t.actorUuid);
}

export function vehicleInfos(c: CaravanState): VehicleInfo[] {
  return c.vehicles.map((v) => {
    const a = actor(v.actorUuid);
    const { hp, maxHp } = a ? pf1Adapter.vehicleHp(a) : { hp: 0, maxHp: 0 };
    const riders = c.travellers.filter((t) => t.seat === v.actorUuid && t.actorUuid !== v.driver && !v.team.includes(t.actorUuid));
    const extra = riders.slice(v.seats).reduce((sum, t) => sum + pf1Adapter.riderWeight(actor(t.actorUuid)), 0);
    const teamStrength = v.team.reduce((sum, uuid) => sum + pf1Adapter.pullStrength(actor(uuid)), 0);
    return {
      actorUuid: v.actorUuid,
      name: a?.name ?? v.name,
      milesPerDay: v.milesPerDay,
      hp,
      maxHp,
      cargo: (a ? pf1Adapter.inventoryWeight(a) : 0) + extra,
      cargoCapacity: v.cargoCapacity,
      teamStrength,
      teamRequired: v.teamRequired,
      driver: v.driver,
    };
  });
}

/** The day's context; `party` builds it from the party's view of the map (player-safe). */
export function buildDayContext(party = !game.user?.isGM): DayContext {
  const c = store.getCaravan();
  const sceneId = c.sceneId ?? undefined;
  const map: MapData = party ? store.partyView(sceneId) : store.getMap(sceneId);
  const knowledge: PartyMap = store.getPartyMap(sceneId);
  const walkers: WalkerInfo[] = walkerUuids(c).map((uuid) => {
    const a = actor(uuid);
    return { actorUuid: uuid, name: a?.name ?? "?", landSpeed: a ? pf1Adapter.landSpeed(a) : 30 };
  });
  const trip = c.trip;
  return {
    activity: trip?.activity ?? c.plan.activity,
    position: c.position ?? "",
    course: trip ? trip.course : c.plan.course,
    map,
    knowledge: knowledge.knowledge,
    eaters: c.travellers.map((t) => ({ actorUuid: t.actorUuid, food: t.food, water: t.water, wage: t.wage })),
    vehicles: vehicleInfos(c),
    walkers,
    roles: c.roles,
    rolesHeld: rolesHeld(c),
    stock: store.supplyTotals(),
    funds: c.funds,
    repairStock: store.repairValue(),
    tripDay: (trip?.day ?? 0) + 1,
    exploreDays: trip?.exploreDays ?? 0,
    settings: store.getSettings(),
  };
}

/** The caravan's pace right now, for the Caravan sheet's Speed tile. */
export function paceNow(): Pace | null {
  try {
    return engine.pace(buildDayContext());
  } catch (err) {
    console.error("pf1-hexploration | pace failed", err);
    return null;
  }
}

// Domain types shared by every layer. The engine (src/engine/) uses only these and
// plain values — never Foundry objects (invariant 3). DESIGN.md (MVP rework, ADR-0008) is the spec.

export const MODULE_ID = "pf1-hexploration";
/** The Caravan actor subtype (DESIGN §4.4). */
export const CARAVAN_TYPE = `${MODULE_ID}.caravan`;
/** Prototype-token settings for a caravan (also applied by "Place on map"). */
export const CARAVAN_TOKEN = {
  actorLink: true,
  bar1: { attribute: null },
  bar2: { attribute: null },
  displayBars: 0, // CONST.TOKEN_DISPLAY_MODES.NONE
  displayName: 30, // CONST.TOKEN_DISPLAY_MODES.HOVER
};

/** Foundry v13 offset coordinates of a hex, as `${i},${j}` (i = row, j = column). */
export type HexKey = string;

export type KnowledgeState = "unknown" | "explored" | "mapped";
export type SupplyTrack = "rations" | "water";

// ---------- Terrain (DESIGN §4.2) ----------

export type Terrain =
  | "desert-sandy"
  | "desert-rocky"
  | "forest"
  | "hills"
  | "jungle"
  | "moor"
  | "mountains"
  | "plains"
  | "swamp"
  | "tundra"
  | "settlement"
  | "water";

/** UC exploration-time classes (Ultimate Campaign, Exploration Time table). */
export type ExploreClass = "plain" | "desert" | "mountain";

export interface TerrainRule {
  label: string;
  /** CRB Table 7-8 multipliers. */
  highway: number;
  road: number;
  trackless: number;
  /** CRB getting-lost Survival DC (before the daily +4). null = impassable. */
  lostDc: number | null;
  /** Wear die size off-road (d4/d6/d8). 0 = impassable. */
  wearDie: number;
  explore: ExploreClass;
  passable: boolean;
}

export const TERRAIN_RULES: Record<Terrain, TerrainRule> = {
  "desert-sandy": { label: "Desert (sandy)", highway: 1, road: 0.5, trackless: 0.5, lostDc: 14, wearDie: 6, explore: "desert", passable: true },
  "desert-rocky": { label: "Desert (rocky)", highway: 1, road: 1, trackless: 0.75, lostDc: 14, wearDie: 4, explore: "desert", passable: true },
  forest: { label: "Forest", highway: 1, road: 1, trackless: 0.5, lostDc: 16, wearDie: 6, explore: "desert", passable: true },
  hills: { label: "Hills", highway: 1, road: 0.75, trackless: 0.5, lostDc: 10, wearDie: 6, explore: "plain", passable: true },
  jungle: { label: "Jungle", highway: 1, road: 0.75, trackless: 0.25, lostDc: 16, wearDie: 8, explore: "desert", passable: true },
  moor: { label: "Moor", highway: 1, road: 1, trackless: 0.75, lostDc: 10, wearDie: 4, explore: "desert", passable: true },
  mountains: { label: "Mountains", highway: 0.75, road: 0.75, trackless: 0.5, lostDc: 12, wearDie: 6, explore: "mountain", passable: true },
  plains: { label: "Plains", highway: 1, road: 1, trackless: 0.75, lostDc: 14, wearDie: 4, explore: "plain", passable: true },
  swamp: { label: "Swamp", highway: 1, road: 0.75, trackless: 0.5, lostDc: 16, wearDie: 6, explore: "desert", passable: true },
  tundra: { label: "Tundra", highway: 1, road: 0.75, trackless: 0.75, lostDc: 14, wearDie: 4, explore: "plain", passable: true },
  settlement: { label: "Settlement", highway: 1, road: 1, trackless: 1, lostDc: 8, wearDie: 4, explore: "plain", passable: true },
  water: { label: "Water", highway: 0, road: 0, trackless: 0, lostDc: null, wearDie: 0, explore: "plain", passable: false },
};

export const TERRAIN_KEYS = Object.keys(TERRAIN_RULES) as Terrain[];

/** Ultimate Campaign terrain elements (DESIGN §4.2): the only hex tags. */
export const UC_TAGS = ["difficult", "feature", "hunting-ground", "resource", "secret", "standard"] as const;
export type UcTag = (typeof UC_TAGS)[number];

// ---------- Map ----------

/** Values stamped onto a hex when it is painted (by a region, or the map for region-less hexes). */
export interface HexDefaults {
  terrain: Terrain;
  tags: UcTag[];
}

/** Travel rules a region carries; the map has the same set for region-less hexes. */
export interface TravelRules {
  encounterTable: string | null; // RollTable UUID
  /** roleId -> DC modifier; key "*" applies to every role (e.g. Stormlands +5). Driver roles use "driver". */
  dcMods: Record<string, number>;
  rationsMultiplier: number; // 1 normally
  waterMultiplier: number; // 1 normally; a desert ×2
}

export interface HexRecord {
  key: HexKey;
  terrain: Terrain;
  region: string | null; // Region.id
  tags: UcTag[];
}

export interface Region extends TravelRules {
  id: string;
  name: string;
  color: string; // "#rrggbb" or "#rrggbbaa"
  defaults?: HexDefaults;
}

export interface Landmark {
  id: string;
  name: string;
  hex: HexKey;
  description: string;
  knownToParty: boolean;
  icon?: string; // Font Awesome name, e.g. "fa-tower-observation"; default "fa-location-dot"
}

export type RouteKind = "highway" | "road";

/** A road: a named chain of adjacent hexes (DESIGN §4.2). */
export interface Route {
  id: string;
  name: string;
  from: HexKey; // first hex
  hexes: HexKey[]; // the following hexes, in order (so the chain is [from, ...hexes])
  kind: RouteKind;
  color?: string; // default brown
  knownToParty: boolean;
}

/** GM truth for one scene: everything the map contains. */
export interface MapData {
  /** Border colour for hexes outside any region (default grey). */
  baseColor?: string;
  /** Stamped onto new hexes outside any region. */
  defaults?: HexDefaults;
  /** Travel rules for hexes outside any region. */
  rules?: TravelRules;
  hexes: Record<HexKey, HexRecord>;
  regions: Record<string, Region>;
  landmarks: Record<string, Landmark>;
  routes: Record<string, Route>;
  /** Data format; 2 = the MVP rework. Missing = 0.1.x (migrated on load). */
  version?: number;
}

/** What the party knows about one scene's map. */
export interface PartyMap {
  knowledge: Record<HexKey, KnowledgeState>;
  /** Hexes explored to the end (Explore activity): their Secret element shows. */
  revealed?: HexKey[];
}

// ---------- Roles (DESIGN §4.5, §4.6) ----------

export type RoleId = "navigator" | "scout" | "forager" | "wainwright" | "cartographer" | "healer";
export const ROLE_IDS: RoleId[] = ["navigator", "scout", "forager", "wainwright", "cartographer", "healer"];

export interface RoleDef {
  id: RoleId | "driver";
  name: string;
  skills: string[]; // pf1 skill ids: "sur", "per", "han", "kge", "kna", "hea", "pro", "crf"
}

export const ROLE_DEFS: Record<RoleId | "driver", RoleDef> = {
  navigator: { id: "navigator", name: "Navigator", skills: ["sur", "pro"] },
  scout: { id: "scout", name: "Scout", skills: ["per", "pro"] },
  forager: { id: "forager", name: "Forager", skills: ["sur", "kna", "pro"] },
  driver: { id: "driver", name: "Driver", skills: ["han", "pro"] },
  wainwright: { id: "wainwright", name: "Wainwright", skills: ["crf", "pro"] },
  cartographer: { id: "cartographer", name: "Cartographer", skills: ["kge", "pro"] },
  healer: { id: "healer", name: "Healer/Cook", skills: ["hea", "pro"] },
};

/** A check slot for one day: a role id, or `driver:<vehicle actor uuid>`. */
export type CheckId = string;

// ---------- Caravan (DESIGN §4.4, §4.7) ----------

export interface Traveller {
  actorUuid: string;
  name: string;
  food: number; // person-days eaten per day (size multiplier; 0 for constructs/undead)
  water: number; // person-days drunk per day
  wage: number; // copper pieces per day (0 for PCs)
  seat: string | null; // vehicle actor UUID the traveller rides in, or null = on foot
}

export interface VehicleLink {
  actorUuid: string;
  name: string;
  driver: string | null; // traveller actor UUID
  team: string[]; // traveller actor UUIDs pulling it
  /** Team needed, in Large-creature equivalents (UE: 2 Medium = 1 Large). */
  teamRequired: number;
  seats: number;
  cargoCapacity: number; // lb
  milesPerDay: number; // overland pace (CRB carts and wagons: 16)
}

export type Activity = "travel" | "explore" | "forage" | "rest";

/** The party's shared plan; the GM approves it to start a trip (DESIGN §4.10). */
export interface Plan {
  activity: Activity;
  /** Travel: hexes to enter, in order, starting next to the caravan's position. */
  course: HexKey[];
  routeId: string | null; // set when the course was picked from a known route
  /** Who last changed it (user name) and what they did, for the Travel window. */
  lastEdit: { user: string; text: string } | null;
}

export interface Trip {
  activity: Activity;
  course: HexKey[]; // hexes still to enter (travel)
  day: number; // days completed so far in this trip
  exploreDays: number; // explore: days spent in this hex so far
}

export interface CaravanState {
  travellers: Traveller[];
  vehicles: VehicleLink[];
  /** Sticky role holders (actor UUIDs). Drivers live on each VehicleLink. */
  roles: Partial<Record<RoleId, string | null>>;
  funds: number; // party funds, copper pieces
  sceneId: string | null;
  position: HexKey | null;
  journeyDay: number; // total days on the road, feeds nothing but the record
  plan: Plan;
  trip: Trip | null;
}

export interface CaravanSettings {
  doublingPenalty: number; // applied to BOTH rolls of an actor holding two roles (default 4)
}

// ---------- Caravan service results (hx.caravan) ----------

export type CaravanErrorCode =
  | "gm-only" // not the GM's client
  | "not-owner" // a player acting on an actor they don't own
  | "trip-active" // a change refused while a trip is underway
  | "not-hex-scene"
  | "off-grid"
  | "no-caravan-actor"
  | "unknown-actor"
  | "caravan-actor"
  | "duplicate"
  | "not-member"
  | "not-vehicle"
  | "too-many-roles" // an actor would hold more than two roles
  | "insufficient-funds"
  | "bad-value"
  | "failed";

export type CaravanResult = { ok: true; caravan: CaravanState } | { ok: false; code: CaravanErrorCode; error: string };

export interface Coins {
  pp: number;
  gp: number;
  sp: number;
  cp: number;
}

// ---------- Authority requests (invariant 2) ----------

export type Request =
  | { type: "addActor"; actorUuid: string }
  | { type: "removeActor"; actorUuid: string }
  | { type: "setSeat"; actorUuid: string; vehicleUuid: string | null }
  | { type: "setDriver"; vehicleUuid: string; actorUuid: string | null }
  | { type: "setTeam"; vehicleUuid: string; actorUuid: string; on: boolean }
  | { type: "setRole"; roleId: RoleId; actorUuid: string | null }
  | { type: "funds"; actorUuid: string; coins: Coins; direction: "deposit" | "withdraw" }
  | { type: "setPlan"; activity: Activity; course: HexKey[]; routeId: string | null; text: string }
  | { type: "askStop" };

export interface RequestEnvelope {
  id: string;
  userId: string; // sender
  request: Request;
}

export interface RequestResult {
  ok: boolean;
  error?: string;
}

// ---------- The day (engine ⇄ travel, DESIGN §4.5–§4.11) ----------

export interface VehicleInfo {
  actorUuid: string;
  name: string;
  milesPerDay: number;
  hp: number;
  maxHp: number;
  cargo: number; // lb carried, riders beyond the seats included
  cargoCapacity: number;
  teamStrength: number; // Large equivalents pulling
  teamRequired: number;
  driver: string | null;
}

export interface WalkerInfo {
  actorUuid: string;
  name: string;
  landSpeed: number; // ft, after pf1's own encumbrance
}

export interface EaterInfo {
  actorUuid: string;
  food: number;
  water: number;
  wage: number; // cp/day
}

export interface DayContext {
  activity: Activity;
  position: HexKey;
  course: HexKey[]; // hexes still to enter (travel)
  map: MapData; // GM truth (the engine applies map.rules to region-less hexes)
  knowledge: Record<HexKey, KnowledgeState>;
  eaters: EaterInfo[];
  vehicles: VehicleInfo[];
  walkers: WalkerInfo[]; // travellers on foot (not riding, driving or pulling)
  roles: Partial<Record<RoleId, string | null>>;
  rolesHeld: Record<string, number>; // actor UUID -> roles held, driving included (doubling)
  stock: { rations: number; water: number }; // person-days in the vehicles
  funds: number; // cp
  /** Value of the repair materials in the vehicles, cp (DESIGN §4.6: repairs use 10 gp of them). */
  repairStock: number;
  tripDay: number; // 1-based day of the trip (encounter bonus)
  exploreDays: number; // days already spent exploring this hex
  settings: CaravanSettings;
}

export interface CheckSpec {
  id: CheckId; // a RoleId, or `driver:<vehicle uuid>`
  roleId: RoleId | "driver";
  label: string; // "Navigator", "Driver (Wagon)"
  actorUuid: string | null; // null = vacant (fails)
  skills: string[];
  dc: number;
  penalty: number; // doubling penalty to subtract from the roll
  bonus: number; // added to the roll (Navigator +4 in a Mapped hex)
  auto: boolean; // no roll: automatic success (road)
}

export interface Pace {
  milesPerDay: number;
  setBy: string; // name of the vehicle or walker setting it
  blocked: string | null; // why the caravan can't move, or null
}

export interface DayPreview {
  moving: boolean;
  pace: Pace;
  hexes: HexKey[]; // hexes the caravan enters today if the Navigator succeeds
  road: boolean; // every step today is on a route
  checks: CheckSpec[]; // every check made today (auto ones included)
}

export interface CheckResult extends CheckSpec {
  total: number | null; // roll + bonus - penalty; null = vacant or unreadable
  success: boolean;
}

export interface DayOutcome {
  checks: CheckResult[];
  pace: Pace;
  moved: HexKey[]; // hexes entered (empty when lost, blocked or stationary)
  lost: boolean;
  end: HexKey; // where the caravan ends the day
  drain: { rations: number; water: number }; // person-days to remove
  preserved: SupplyTrack[]; // tracks the Forager kept undrained
  wages: number; // cp due today
  wear: { vehicleUuid: string; dice: string; damage: number }[];
  repair: { vehicleUuid: string; hp: number; cost: number } | null;
  knowledge: Record<HexKey, KnowledgeState>; // states to raise to
  revealed: HexKey | null; // explored to the end (all elements shown)
  exploreDaysNeeded: number; // explore: total days this hex takes
  encounter: { d20: number; bonus: number; total: number; table: string | null };
  surprised: boolean;
  longTermCare: boolean;
  /** The trip ends after this day (destination reached, exploring done, one-day activity done). */
  done: boolean;
}

// Domain types shared by every layer. The engine (src/engine/) uses only these and
// plain values — never Foundry objects (invariant 3).

export const MODULE_ID = "pf1-hexploration";
/** The Caravan actor subtype (DESIGN §4.6). */
export const CARAVAN_TYPE = `${MODULE_ID}.caravan`;
/** Prototype-token settings for a caravan (also applied by the Caravan window's "Place on map"). */
export const CARAVAN_TOKEN = {
  actorLink: true,
  bar1: { attribute: null },
  bar2: { attribute: null },
  displayBars: 0, // CONST.TOKEN_DISPLAY_MODES.NONE
  displayName: 30, // CONST.TOKEN_DISPLAY_MODES.HOVER
};

/** Foundry v13 offset coordinates of a hex, as `${i},${j}` (i = row, j = column). */
export type HexKey = string;

export type Difficulty = "easy" | "standard" | "hard" | "brutal";
export const DIFFICULTIES: Difficulty[] = ["easy", "standard", "hard", "brutal"];

/** Wagon Condition lost per day by difficulty (KtP: Easy 0, Standard 1, Hard 2, Brutal 3). */
export const WAGON_DRAIN: Record<Difficulty, number> = { easy: 0, standard: 1, hard: 2, brutal: 3 };
/** Encounter bonus by difficulty (KtP: +0 / +2 / +5 / +10). */
export const ENCOUNTER_BONUS: Record<Difficulty, number> = { easy: 0, standard: 2, hard: 5, brutal: 10 };

export type KnowledgeState = "unknown" | "explored" | "mapped";
export type SupplyTrack = "rations" | "water";
export type Track = SupplyTrack | "wagon";

/** Built-in Ultimate Campaign terrain elements (DESIGN §4.2). Custom tags are any other string. */
export const UC_TAGS = ["difficult", "feature", "hunting-ground", "resource", "secret", "standard"] as const;

/** Values stamped onto a hex when it is created: by a region (Region.defaults) or by the map for region-less hexes. */
export interface HexDefaults {
  terrain: string;
  difficulty: Difficulty;
  tags: string[];
  encounterMod: number;
}

/** Travel rules for hexes outside any region: the same rules a Region carries. */
export interface MapRules {
  dcMods: Record<string, number>;
  encounterTable: string | null;
  waterMultiplier: number;
  stormThreshold: number | null;
}

/** Synthetic region id the engine uses for hexes outside any region (built from MapData.rules). */
export const MAP_REGION_ID = "__map__";

export interface HexRecord {
  key: HexKey;
  terrain: string; // free label, e.g. "desert", "dunes", "salt flat"
  difficulty: Difficulty;
  region: string | null; // Region.id
  tags: string[]; // UC_TAGS and custom tags
  encounterMod?: number; // added to this hex's daily encounter roll (default 0)
}

export interface Region {
  id: string;
  name: string;
  color: string; // CSS colour used to tint the region's hexes
  encounterTable: string | null; // RollTable UUID
  dcMods: Record<string, number>; // roleId -> DC modifier; key "*" applies to every role
  waterMultiplier: number; // 1 normally; heat bands later
  stormThreshold: number | null; // encounter total at/above which the GM is told the storm reaches for them
  defaults?: HexDefaults; // stamped onto hexes painted into this region
}

export interface Landmark {
  id: string;
  name: string;
  hex: HexKey;
  description: string;
  knownToParty: boolean;
  icon?: string; // Font Awesome name, e.g. "fa-tower-observation"; default "fa-location-dot"
}

export type RouteEffect =
  | { type: "replenish"; track: SupplyTrack | "either"; amount: number } // once, on arrival
  | { type: "extraDrain"; track: Track; perDay: number }
  | { type: "dcMod"; roleId: string; mod: number }
  | { type: "setMapState"; state: KnowledgeState }; // applied to the leg's hexes on arrival

export type PromptTrigger =
  | { kind: "roleSuccess"; roleId: string }
  | { kind: "roleFailure"; roleId: string }
  | { kind: "day"; day: number }; // 1-based day of the leg

export interface GmPrompt {
  when: PromptTrigger;
  text: string;
}

export interface Route {
  id: string;
  name: string;
  /** Ordered hexes the caravan enters, NOT including the starting hex. Length = hexes travelled. */
  hexes: HexKey[];
  from: HexKey; // starting hex
  days: number; // expected days (normally hexes.length)
  difficulty: Difficulty;
  encounterBonus: number;
  bargain: string; // player-facing pitch
  color?: string; // "#rrggbb" or "#rrggbbaa"; default brown
  effects: RouteEffect[];
  prompts: GmPrompt[];
  knownToParty: boolean;
}

/** A route's display label: its name, or a short description when it has none ("3-day easy route"). */
export function routeLabel(route: Pick<Route, "name" | "days" | "difficulty">): string {
  return route.name?.trim() || `${route.days}-day ${route.difficulty} route`;
}

/** GM truth for one scene: everything the map contains. */
export interface MapData {
  /** Border colour for hexes outside any region (default grey). */
  baseColor?: string;
  /** Stamped onto new hexes outside any region. */
  defaults?: HexDefaults;
  /** Travel rules for hexes outside any region. */
  rules?: MapRules;
  hexes: Record<HexKey, HexRecord>;
  regions: Record<string, Region>;
  landmarks: Record<string, Landmark>;
  routes: Record<string, Route>;
}

/** What the party knows about one scene's map. */
export interface PartyMap {
  knowledge: Record<HexKey, KnowledgeState>;
}

// ---------- Roles ----------

export type RoleEffect =
  | { type: "addDays"; days: number } // once per leg (Navigator/Driver failure)
  | { type: "surprise"; surprised: boolean } // Scout
  | { type: "preserveOne" } // Forager success: each day, choose rations OR water not to drain
  | { type: "wagonPerDay"; delta: number } // Wainwright: +1 repair on success, -1 extra on failure
  | { type: "setMapState"; state: KnowledgeState } // Cartographer
  | { type: "rest" } // Healer success: no forced march
  | { type: "forcedMarch" }; // Healer failure/vacant: daily Fort save

export interface RoleDef {
  id: string;
  name: string;
  skills: string[]; // pf1 skill ids: "sur", "per", "han", "kge", "kna", "hea", "pro", "crf"
  baseDc: number;
  /** "forager": DC = 10 + 2 * (eaters - 1) instead of baseDc. */
  dcFormula: "fixed" | "forager";
  success: RoleEffect[];
  failure: RoleEffect[];
  vacant: RoleEffect[]; // when nobody holds the role (usually = failure)
}

// ---------- Caravan ----------

export interface RosterMember {
  actorUuid: string;
  name: string;
  food: number; // person-days eaten per day (size multiplier; 0 for constructs/undead)
  water: number; // person-days drunk per day
  draft: boolean; // pulls the wagon
  npc: boolean; // auto-rolls saves (GM-run, companion, animal)
}

export interface Assignment {
  roleId: string;
  actorUuid: string;
}

export interface RoleRoll {
  roleId: string;
  actorUuid: string;
  total: number;
}

export interface LegPlan {
  routeId: string | null; // null = off-route plotted path
  from: HexKey;
  path: HexKey[]; // hexes entered, in order
  baseDays: number;
  difficulty: Difficulty;
  encounterBonus: number;
  effects: RouteEffect[];
  prompts: GmPrompt[];
  regionId: string | null; // region whose DC mods apply (the destination's, or the hardest hex's)
}

export interface RoleOutcome {
  roleId: string;
  actorUuid: string | null; // null = vacant
  dc: number;
  total: number | null;
  success: boolean;
  doubled: boolean;
}

export interface DayPlan {
  day: number; // 1-based
  hex: HexKey; // where the caravan ends the day
  drain: { rations: number; water: number; wagon: number }; // positive = amount removed
  encounterBonus: number;
  regionId: string | null;
  forcedMarchDc: number | null; // Fort DC owed by each traveler today, or null
  preserveChoice: boolean; // Forager success: party picks rations or water to keep today
  prompts: string[]; // GM prompt texts due today
}

export interface LegOutcome {
  roles: RoleOutcome[];
  totalDays: number;
  surprised: boolean;
  mapState: KnowledgeState; // applied to path hexes on arrival
  days: DayPlan[];
  arrivalPrompts: string[]; // role success/failure prompts
  replenish: RouteEffect[]; // replenish effects applied on arrival
}

export type LegStatus = "muster" | "underway" | "arrived";

export interface SaveOwed {
  actorUuid: string;
  dc: number;
  day: number;
  total: number | null; // filled when rolled
}

export interface LegState {
  id: string;
  status: LegStatus;
  plan: LegPlan;
  assignments: Assignment[];
  rolls: RoleRoll[];
  outcome: LegOutcome | null; // set when the GM resolves the muster
  dayIndex: number; // days completed so far
  saves: SaveOwed[];
  preserveChoices: Record<number, SupplyTrack>; // day -> track preserved
}

export interface CaravanState {
  roster: RosterMember[];
  wagon: { condition: number; max: number };
  draftRequired: number;
  sceneId: string | null;
  position: HexKey | null;
  journeyDay: number; // total travel days, feeds the encounter check
  consecutiveForcedMarch: number;
  leg: LegState | null;
}

export interface CaravanSettings {
  doublingPenalty: number; // applied to BOTH rolls of a doubled actor (default 4)
  forcedMarchBaseDc: number; // default 10
  forcedMarchStep: number; // +2 per consecutive day
}

// ---------- Caravan service results (hx.caravan) ----------

export type CaravanErrorCode =
  | "gm-only" // not the GM's client
  | "leg-active" // place/unplace while a leg is mustering or underway
  | "not-hex-scene" // the scene's grid isn't hexagonal
  | "off-grid" // the hex isn't on the scene (or the scene doesn't exist)
  | "no-caravan-actor" // no caravan designated or created yet
  | "unknown-actor" // the UUID doesn't resolve
  | "caravan-actor" // tried to add a caravan-type actor
  | "duplicate" // the actor is already on the roster
  | "not-member" // remove/update an actor who isn't on the roster
  | "holds-role" // remove someone holding a role in the active leg (the error names the role)
  | "bad-value" // negative food/water, non-integer draft count, malformed hex key, ...
  | "failed"; // Foundry threw while applying the change (the error says what)

/** Every hx.caravan write returns one of these; `error` is the sentence a person would see. */
export type CaravanResult =
  | { ok: true; caravan: CaravanState; ledgerId: string }
  | { ok: false; code: CaravanErrorCode; error: string };

export interface MemberOpts {
  draft?: boolean;
  npc?: boolean;
}

export interface MemberPatch {
  draft?: boolean;
  npc?: boolean;
  food?: number;
  water?: number;
}

/** Importable content pack (campaign data lives outside the module repo, DESIGN §4.12). */
export interface Pack {
  format: "pf1-hexploration-pack";
  version: 1;
  name: string;
  roles?: RoleDef[];
  settings?: Partial<CaravanSettings>;
  map?: MapData;
}

// ---------- Ledger (invariant 4) ----------

export type Change =
  /** containerUuid/itemId are set when the item sits inside a pf1 container (no resolvable UUID of its own). */
  | { kind: "itemQuantity"; itemUuid: string; before: number; after: number; containerUuid?: string; itemId?: string }
  | { kind: "condition"; actorUuid: string; condition: string; before: boolean; after: boolean }
  | { kind: "knowledge"; sceneId: string; key: HexKey; before: KnowledgeState; after: KnowledgeState }
  | { kind: "caravan"; before: CaravanState; after: CaravanState }
  | { kind: "token"; tokenUuid: string; before: { x: number; y: number }; after: { x: number; y: number } }
  | { kind: "worldTime"; seconds: number }
  | { kind: "tokenCreate"; tokenUuid: string } // undo deletes the token
  | { kind: "tokenDelete"; sceneId: string; data: Record<string, unknown> }; // undo recreates it

export interface LedgerEntry {
  id: string;
  label: string;
  changes: Change[];
}

// ---------- Authority requests (invariant 2) ----------

export type Request =
  | { type: "claimRole"; roleId: string; actorUuid: string }
  | { type: "releaseRole"; roleId: string; actorUuid: string }
  | { type: "submitRoleRoll"; roleId: string; actorUuid: string; total: number }
  | { type: "submitSave"; actorUuid: string; day: number; total: number }
  | { type: "preserveChoice"; day: number; track: SupplyTrack };

export interface RequestEnvelope {
  id: string;
  userId: string; // sender
  request: Request;
}

export interface RequestResult {
  ok: boolean;
  error?: string;
}

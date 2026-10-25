// Service contracts between layers. Each layer's index.ts exports an object that
// `satisfies` its interface, so parallel work stays compatible. Foundry objects are
// typed `any` (no Foundry type package); domain data uses src/types.ts.
import type {
  Assignment,
  CaravanSettings,
  CaravanState,
  Change,
  HexKey,
  HexRecord,
  KnowledgeState,
  LedgerEntry,
  LegOutcome,
  LegPlan,
  MapData,
  Pack,
  PartyMap,
  Region,
  Request,
  RequestResult,
  RoleDef,
  RoleRoll,
  RosterMember,
  SupplyTrack,
} from "./types";

// ---------- Engine (src/engine/, pure: invariant 3) ----------

export interface Roller {
  /** An integer in [1, 20]. */
  d20(): number;
}

export interface ResolveLegInput {
  plan: LegPlan;
  roles: RoleDef[];
  assignments: Assignment[];
  rolls: RoleRoll[];
  roster: RosterMember[];
  hexes: Record<HexKey, HexRecord>;
  regions: Record<string, Region>;
  settings: CaravanSettings;
  consecutiveForcedMarch: number; // carried in from earlier legs
}

export interface EngineApi {
  DEFAULT_ROLES: RoleDef[];
  DEFAULT_SETTINGS: CaravanSettings;
  /** Daily person-days of food and water for the roster. */
  consumption(roster: RosterMember[]): { food: number; water: number };
  /** Number of roster members who eat (food > 0): the Forager formula's "eaters". */
  eaters(roster: RosterMember[]): number;
  /** DC for one role on this leg, before any doubling penalty (doubling lowers the roll, not the DC). */
  roleDc(role: RoleDef, plan: LegPlan, regions: Record<string, Region>, roster: RosterMember[]): number;
  /** Roles an actor holds in the assignments (for doubling detection). */
  rolesHeldBy(actorUuid: string, assignments: Assignment[]): string[];
  /** Penalty applied to each roll of this actor (0, or settings.doublingPenalty when holding 2+ roles). */
  doublingPenalty(actorUuid: string, assignments: Assignment[], settings: CaravanSettings): number;
  /** Resolve a mustered leg: role outcomes, total days, the day-by-day plan. Deterministic. */
  resolveLeg(input: ResolveLegInput): LegOutcome;
  /** Leg plan from a named route in the map. */
  planFromRoute(map: MapData, routeId: string): LegPlan;
  /** Leg plan for an off-route path: DC from the hardest hex, region of the hardest hex. */
  planFromPath(map: MapData, from: HexKey, path: HexKey[]): LegPlan;
  /** The encounter check total for a day: d20 + journeyDay + bonus. */
  encounterTotal(roller: Roller, journeyDay: number, bonus: number): { d20: number; total: number };
  /** Are two hexes adjacent on a Foundry hex grid? (offset coords, `columns` = column-based hex grid, `even` = even offset). */
  hexAdjacent(a: HexKey, b: HexKey, columns: boolean, even: boolean): boolean;
  /** Seeded roller for tests and reproducible play (mulberry32). */
  seededRoller(seed: number): Roller;
}

// ---------- Store (src/store/) ----------

export interface SupplyItem {
  item: any; // pf1 Item in the caravan actor's inventory
  track: SupplyTrack;
  unitsPerQuantity: number; // flag; default 1 person-day per quantity
  /** The pf1 container holding the item, or null for a loose item. Drain uses loose items first. */
  container: any | null;
}

export interface StoreApi {
  /** Register world settings (call in init). */
  registerSettings(): void;
  /** The caravan: the designated `pf1-hexploration.caravan` actor (world setting `caravanActor`), else the world's first actor of that type. Its inventory is the hold; its token is the map marker. */
  getCaravanActor(): any | null;
  setCaravanActor(uuid: string | null): Promise<void>;
  getCaravan(): CaravanState; // defaults when unset
  setCaravan(next: CaravanState): Promise<void>; // GM only (throws otherwise)
  getSettings(): CaravanSettings;
  getRoles(): RoleDef[];
  setRoles(roles: RoleDef[]): Promise<void>;
  /** GM truth for a scene (default: canvas scene). */
  getMap(sceneId?: string): MapData;
  setMap(map: MapData, sceneId?: string): Promise<void>; // GM only
  getPartyMap(sceneId?: string): PartyMap;
  setKnowledge(sceneId: string, keys: HexKey[], state: KnowledgeState): Promise<void>; // GM only
  /** Map filtered to what the party knows: explored/mapped hexes, known routes/landmarks. Use for every player-facing render. */
  partyView(sceneId?: string): MapData;
  /** Loose supply items first, then items inside containers (a container flagged as a supply makes all its contents count). */
  supplyItems(): SupplyItem[];
  /** GM: set a supply item's quantity (whole numbers only: pf1 zeroes non-integers), loose or inside a container. Returns the ledger change. */
  setSupplyQuantity(supply: SupplyItem, quantity: number): Promise<Change>;
  supplyTotals(): { rations: number; water: number };
  /** Subscribe to any change in caravan, map, knowledge or supplies. Returns an unsubscribe fn. */
  onChange(cb: () => void): () => void;
  /** Emit a change notification (called by writers after a write). */
  notify(): void;
  /** GM: load a pack's roles/settings into the world and its map into the scene (replacing the scene's map). */
  importPack(pack: Pack, sceneId?: string): Promise<void>;
  /** Current roles/settings and the scene's map as a pack. */
  exportPack(name: string, sceneId?: string): Pack;
}

// ---------- Authority (src/authority/, invariant 2) ----------

export type RequestHandler = (request: Request, userId: string) => Promise<RequestResult>;

export interface AuthorityApi {
  init(): void; // register the socket listener (call in ready)
  /** GM: run locally. Player: emit to the active GM and await the reply (timeout -> {ok:false}). */
  send(request: Request): Promise<RequestResult>;
  registerHandler(type: Request["type"], handler: RequestHandler): void;
  isActiveGM(): boolean;
}

// ---------- Ledger (src/ledger/, invariant 4) ----------

export interface LedgerApi {
  /** Record changes that were just applied (GM only). Stored on the caravan actor. */
  record(label: string, changes: Change[]): Promise<LedgerEntry>;
  /** Revert the most recent entry, newest change first, and drop it. */
  undoLast(): Promise<LedgerEntry | null>;
  entries(): LedgerEntry[];
}

// ---------- pf1 adapter (src/pf1/) ----------

export interface Pf1Api {
  /** PF1e gear-weight size multiplier (DESIGN §4.6): tiny- 0.1, sm 0.5, med 1, lg 2, huge 5, grg 8, col 12. */
  sizeMultiplier(actor: any): number;
  /** Default food/water per day for an actor: size multiplier, 0 for constructs and undead. */
  consumptionFor(actor: any): { food: number; water: number };
  /** Build a roster member from an actor (defaults from size/type; npc = no player owner). */
  rosterMemberFor(actor: any, draft?: boolean): RosterMember;
  /** The allowed skill with the highest modifier for this actor. */
  bestSkill(actor: any, skills: string[]): string;
  skillLabel(skillId: string): string;
  /** Roll a pf1 skill on this client (posts the pf1 chat card); returns the total or null if cancelled. */
  rollSkill(actor: any, skillId: string, penalty: number, flavor: string): Promise<number | null>;
  /** Roll a Fortitude save; returns the total or null. */
  rollFort(actor: any, flavor: string): Promise<number | null>;
  hasCondition(actor: any, condition: string): boolean;
  setCondition(actor: any, condition: string, on: boolean): Promise<void>;
  /** Users (non-GM) who own this actor. */
  playerOwners(actor: any): string[];
}

// ---------- Travel controller (src/travel/) ----------

export interface TravelApi {
  init(): void; // register authority handlers (call in ready)
  /** GM: open a muster for a leg. */
  startLeg(plan: LegPlan): Promise<void>;
  cancelLeg(): Promise<void>;
  /** GM: resolve rolls into an outcome; whisper due prompts; status -> underway. */
  resolveMuster(): Promise<void>;
  /** GM: advance one day (token, drain, saves, conditions, encounter, world time, ledger). */
  nextDay(): Promise<void>;
  /** GM: finish the leg after the last day (map state, replenish, arrival prompts). */
  arrive(): Promise<void>;
  undo(): Promise<void>;
  /** Player or GM: roll this actor's role from the owning client and submit it. */
  rollRole(roleId: string, actorUuid: string): Promise<void>;
  /** Player or GM: roll an owed save and submit it. */
  rollSave(actorUuid: string, day: number): Promise<void>;
}

// ---------- Canvas & UI ----------

export interface CanvasApi {
  /** Hooks: canvasReady drawing, scene controls group, store change redraw. Call in init. */
  register(): void;
  openPainter(): void;
  redraw(): void;
  /** The off-route path most recently plotted with the painter's Path tool on this client (GM), or null. */
  getPlottedPath(): { from: HexKey; path: HexKey[] } | null;
}

export interface UiApi {
  register(): void; // call in init (templates, hooks)
  openTravel(): void; // the Muster/Travel window (all users; GM sees controls)
  openCaravan(): void; // the Caravan sheet window (roster, hold, tracks)
}

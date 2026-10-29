// Service contracts between layers. Each layer's index.ts exports an object that
// `satisfies` its interface, so parallel work stays compatible. Foundry objects are
// typed `any` (no Foundry type package); domain data uses src/types.ts.
import type {
  CaravanResult,
  CaravanSettings,
  CaravanState,
  Coins,
  DayContext,
  DayOutcome,
  DayPreview,
  HexKey,
  KnowledgeState,
  MapData,
  Pace,
  PartyMap,
  Request,
  RequestResult,
  RoleId,
  SupplyTrack,
  Traveller,
  VehicleLink,
} from "./types";

// ---------- Engine (src/engine/, pure: invariant 3) ----------

export interface Roller {
  /** An integer in [1, 20]. */
  d20(): number;
  /** An integer in [1, sides]. */
  die(sides: number): number;
}

export interface EngineApi {
  /** The map as the rules see it: hexes outside any region use map.rules (default: no table, ×1, no DC mods). */
  rulesFor(map: MapData, hex: HexKey): import("./types").TravelRules;
  /** The caravan's pace today (slowest moving vehicle or walker; broken, overload, blocked). */
  pace(ctx: DayContext): Pace;
  /** What today will need: whether it moves, the hexes it would enter, and every check with its DC. */
  dayPreview(ctx: DayContext): DayPreview;
  /** Resolve the day from the rolled totals (raw d20 + skill, keyed by CheckSpec.id; null = no readable roll). */
  resolveDay(ctx: DayContext, totals: Record<string, number | null>, roller: Roller): DayOutcome;
  /** UC exploration time for a hex at a pace (DESIGN §4.10). */
  exploreDaysNeeded(map: MapData, hex: HexKey, milesPerDay: number): number;
  /** Are two hexes adjacent on a Foundry hex grid? (offset coords, `columns` = column-based hex grid, `even` = even offset). */
  hexAdjacent(a: HexKey, b: HexKey, columns: boolean, even: boolean): boolean;
  /** Seeded roller for tests and reproducible play (mulberry32). */
  seededRoller(seed: number): Roller;
}

// ---------- Store (src/store/) ----------

export interface SupplyItem {
  item: any; // pf1 Item in a linked vehicle's inventory
  track: SupplyTrack;
  unitsPerQuantity: number; // flag; default 1 person-day per quantity
  /** The pf1 container holding the item, or null for a loose item. Drain uses loose items first. */
  container: any | null;
  vehicleUuid: string;
}

export interface StoreApi {
  registerSettings(): void;
  /** The designated caravan actor (world setting `caravanActor`), else the world's first caravan actor. */
  getCaravanActor(): any | null;
  setCaravanActor(uuid: string | null): Promise<void>;
  getCaravan(): CaravanState; // defaults when unset; migrates 0.1.x state
  setCaravan(next: CaravanState): Promise<void>; // GM only
  getSettings(): CaravanSettings;
  /** GM truth for a scene (default: canvas scene), migrated to the current format. */
  getMap(sceneId?: string): MapData;
  setMap(map: MapData, sceneId?: string): Promise<void>; // GM only
  getPartyMap(sceneId?: string): PartyMap;
  setPartyMap(sceneId: string, party: PartyMap): Promise<void>; // GM only (undo)
  setKnowledge(sceneId: string, keys: HexKey[], state: KnowledgeState): Promise<void>; // GM only
  /** Map filtered to what the party knows. Use for every player-facing render (invariant 1). */
  partyView(sceneId?: string): MapData;
  /** Supply items in the linked vehicles' inventories: loose first, then inside containers. */
  supplyItems(): SupplyItem[];
  /** GM: set a supply item's quantity (whole numbers). */
  setSupplyQuantity(supply: SupplyItem, quantity: number): Promise<void>;
  supplyTotals(): { rations: number; water: number };
  onChange(cb: () => void): () => void;
  notify(): void;
}

// ---------- Authority (src/authority/, invariant 2) ----------

export type RequestHandler = (request: Request, userId: string) => Promise<RequestResult>;

export interface AuthorityApi {
  init(): void;
  /** GM: run locally. Player: emit to the active GM and await the reply (timeout -> {ok:false}). */
  send(request: Request): Promise<RequestResult>;
  registerHandler(type: Request["type"], handler: RequestHandler): void;
  isActiveGM(): boolean;
}

// ---------- Undo (src/ledger/, invariant 4: the last day step) ----------

export interface UndoApi {
  /** GM: capture everything the coming day step can change. Replaces the previous snapshot. */
  capture(label: string): Promise<void>;
  /** GM: restore the last snapshot, once. Returns its label, or null when there is nothing to undo. */
  undo(): Promise<string | null>;
  /** Label of the day that can be undone, or null. */
  available(): string | null;
  /** GM: note world time the day advanced, so undo can rewind it. */
  recordTime(seconds: number): Promise<void>;
}

// ---------- pf1 adapter (src/pf1/) ----------

export interface Pf1Api {
  /** PF1e gear-weight size multiplier: tiny- 0.1, sm 0.5, med 1, lg 2, huge 5, grg 8, col 12. */
  sizeMultiplier(actor: any): number;
  /** pf1 size key ("med", "lg", …). */
  sizeKey(actor: any): string;
  /** Default food/water per day for an actor: size multiplier, 0 for constructs and undead. */
  consumptionFor(actor: any): { food: number; water: number };
  travellerFor(actor: any): Traveller;
  vehicleFor(actor: any): VehicleLink;
  isVehicle(actor: any): boolean;
  /** Land speed in feet, after pf1's own encumbrance. */
  landSpeed(actor: any): number;
  /** Body weight by size plus carried load, lb (riders beyond the seats count as cargo). */
  riderWeight(actor: any): number;
  /** Total weight of an actor's inventory, lb. */
  inventoryWeight(actor: any): number;
  /** Team strength in Large equivalents (Small 0.25, Medium 0.5, Large 1, Huge 2, Gargantuan 4, Colossal 8). */
  pullStrength(actor: any): number;
  vehicleHp(actor: any): { hp: number; maxHp: number };
  setVehicleHp(actor: any, hp: number): Promise<void>;
  coins(actor: any): Coins;
  setCoins(actor: any, coins: Coins): Promise<void>;
  bestSkill(actor: any, skills: string[]): string;
  skillMod(actor: any, skillId: string): number;
  skillLabel(skillId: string): string;
  /** Roll a pf1 skill with no dialog; returns the d20 + skill total (penalty applied), or null. */
  rollSkill(actor: any, skillId: string, penalty: number): Promise<number | null>;
  /** Status labels for the Caravan sheet (pf1 conditions such as Fatigued). */
  conditions(actor: any): string[];
  playerOwners(actor: any): string[];
}

// ---------- Travel controller (src/travel/) ----------

export interface TravelApi {
  init(): void; // register authority handlers (call in ready)
  /** Anyone: change the shared plan (a request; the GM applies it). */
  setPlan(plan: { activity: import("./types").Activity; course: HexKey[]; routeId: string | null }, text: string): Promise<RequestResult>;
  /** GM: approve the plan and start the trip. */
  approve(): Promise<void>;
  /** GM: run one day. Returns the outcome, or null when nothing ran. */
  nextDay(): Promise<DayOutcome | null>;
  /** GM: run days until the trip ends, an encounter turns up, or the caravan can't move. */
  travelAll(): Promise<void>;
  /** GM: end the trip where the caravan is. */
  stop(): Promise<void>;
  /** GM: undo the last day. */
  undo(): Promise<void>;
  /** Today's preview for the Travel window (any client; players get a party-safe one). */
  preview(): DayPreview | null;
}

// ---------- Caravan service (src/caravan/, exposed as hx.caravan) ----------

export interface CaravanApi {
  init(): void; // register authority handlers (call in ready)
  get(): CaravanState;
  traveller(actorUuid: string): Traveller | null;
  vehicle(actorUuid: string): VehicleLink | null;
  /** Placement (GM). */
  place(hex: HexKey, sceneId?: string): Promise<CaravanResult>;
  unplace(sceneId?: string): Promise<CaravanResult>;
  // Edits: on the GM they apply at once; on a player they go as a request. Players act only on actors they own.
  add(actorUuid: string): Promise<CaravanResult>;
  remove(actorUuid: string): Promise<CaravanResult>;
  setSeat(actorUuid: string, vehicleUuid: string | null): Promise<CaravanResult>;
  setDriver(vehicleUuid: string, actorUuid: string | null): Promise<CaravanResult>;
  setTeam(vehicleUuid: string, actorUuid: string, on: boolean): Promise<CaravanResult>;
  setRole(roleId: RoleId, actorUuid: string | null): Promise<CaravanResult>;
  deposit(actorUuid: string, coins: Coins): Promise<CaravanResult>;
  withdraw(actorUuid: string, coins: Coins): Promise<CaravanResult>;
  /** GM: edit a traveller's numbers (food, water, wage) or a vehicle's (seats, capacity, team, pace). */
  updateTraveller(actorUuid: string, patch: Partial<Pick<Traveller, "food" | "water" | "wage">>): Promise<CaravanResult>;
  updateVehicle(actorUuid: string, patch: Partial<Pick<VehicleLink, "seats" | "cargoCapacity" | "teamRequired" | "milesPerDay">>): Promise<CaravanResult>;
}

// ---------- Canvas & UI ----------

export interface CanvasApi {
  register(): void;
  openPainter(): void;
  redraw(): void;
  /** Start plotting a course on the canvas (any user): click a destination, shift-click waypoints. */
  plotCourse(): void;
  getView(): import("./canvas/view").ViewOptions;
  setView(patch: Partial<import("./canvas/view").ViewOptions>): Promise<import("./canvas/view").ViewOptions>;
  openViewPanel(): void;
}

export interface UiApi {
  register(): void;
  openTravel(): void;
  openCaravan(): void;
}

# DESIGN — Canonical Specification & Decision Log

The single source of truth for **why this project is the way it is**. Pre-implementation decisions live
here; decisions made *during* the build are appended as ADRs in [DECISIONS.md](./DECISIONS.md).

Sources: the design interview with the owner on 2026-10-25 (generalising the caravan-role travel system and the
Stormlands routes from the *Keys to Perfection* (KtP) campaign), and the **MVP rework interview on 2026-10-29**
([ADR-0008](./DECISIONS.md)), which cut the module back to its core and moved its numbers onto published PF1 rules
(Core Rulebook, Ultimate Campaign, Ultimate Combat, Ultimate Equipment, Ultimate Wilderness, Jade Regent).

---

## 1. Problem & goals

Long overland travel in Pathfinder 1e is either hand-waved or buried in hourly checks (getting lost, foraging,
driving, heat). KtP's home-brew caravan system fixed that at the table: every PC takes a **caravan role**, the
caravan's supplies drain by who is travelling, and the map is learned as the party crosses it.

The first build (0.1.x) did all of that and more, and turned out to be **too much to maintain, too fragile live**
(KtP #25: muster forms reset, rolls lost, a premature resolve) and **too many clicks at the table**. One roll per
leg also made roads a liability: a single bad roll ruined a whole leg.

**North star (MVP):** the GM paints a hex map of terrain and regions; the party sets up a Caravan of travellers and
vehicles, picks roles once (they stick), and plans what to do; the GM approves and steps the days, and each day
every role is rolled automatically, supplies and wages are spent, vehicles wear, encounters are checked and the
map is learned. Roads make travel faster and safer. The last day can be undone.

## 2. Scope (in / out)

**In (the MVP, ROADMAP Milestone 2):**
- Foundry **v13**, the **pf1** system only (pf1 11.11 declares Foundry 12–13, verified 13).
- Hex map on the scene's native hex grid, **drawn by the module**: published terrain types, UC terrain elements,
  regions, landmarks, named routes (roads). Hex View panel and hover tooltip.
- A **Caravan actor** that links travellers and pf1 **vehicle** actors, holds party funds, sets roles, and is the
  party's token on the map.
- The seven KtP roles, plus a Driver per vehicle, **auto-rolled every day** at DCs drawn from published rules.
- Activities: Travel, Explore, Forage, Rest. Players plan; the GM approves a course; Next Day or Travel all.
- Supplies from the vehicles' inventories, drained by size; wages from party funds; vehicle wear on pf1 HP.
- Party knowledge: Unknown / Explored / Mapped, set by the Cartographer and by exploring.
- Undo of the **last** day step.
- Distribution from a public GitHub repo (release manifest URL), installed on **The Forge**.

**Out of the MVP (in [IDEAS.md](./IDEAS.md), not committed):** route bargains (effects and GM prompts), forced
march, conditions at zero supplies, reveal tags and lore sharing, drift, misdirection, heat, NPC/animal morale,
the request queue with per-action approval settings, party map notes, supply forecast, the Travel mini-map, pack
import/export, the multi-step undo ledger, custom hex tags, difficulty grades.

**Out for good:** other game systems; caravan-scale combat and the Jade Regent trade economy; PC morale; campaign
content inside the module (KtP's regions and routes are a separate world pack, §4.12); Foundry v14 until pf1
supports it (the code stays v14-ready, §4.1).

## 3. Architecture overview

| Layer | Responsibility | Foundry dependency |
|---|---|---|
| **Engine** (`src/engine/`) | Pure rules: pace, role DCs, a day's resolution (role results, movement, drain, wear, wages, encounter roll), exploration time. Takes data + an injected roller; returns results. | **None** (invariant 3) |
| **Model** (`src/model/`) | The Caravan actor subtype's TypeDataModel; hex/region/route/landmark records. | DataModel API |
| **Store** (`src/store/`) | Where each piece of state lives: party-visible vs GM-only truth (invariant 1). | Documents, settings |
| **Authority** (`src/authority/`) | Socket request channel: players request, the active GM validates and writes (invariant 2). | Sockets |
| **Adapters** (`src/pf1/`) | pf1 skill rolls, actor size, type and speed, vehicle HP and inventory, coin. | pf1 public API |
| **Canvas** (`src/canvas/`) | Hex layer, GM brush toolbar, course plotting, landmarks/routes, Hex View panel, tooltip. | Canvas, grid |
| **UI** (`src/ui/`) | Caravan sheet, Travel window, the daily summary card. | ApplicationV2 |
| **Ledger** (`src/ledger/`) | A snapshot of the last day step, so it can be undone (invariant 4). | Store |

**One day, end to end:** the party picks an activity (and, to travel, plots a course or picks a route) → the GM
approves → the GM presses **Next Day** (or **Travel all**) → the engine rolls every role for that day and resolves
it: pace and hexes moved, role results, supplies drained from the vehicles, wages paid from party funds, vehicle
wear, the encounter roll, map knowledge → one summary card posts, the encounter result is whispered to the GM,
the caravan token moves, world time advances one day, and the day's snapshot replaces the previous one.

## 4. Key design decisions

### 4.1 Platform
- Foundry **v13**: `compatibility.minimum 13`, `verified 13`. pf1 is a required system relationship (≥ 11.11).
- Written with ApplicationV2, TypeDataModel and the v13 canvas/grid APIs; nothing deprecated in v13, so the
  v14 bump is small.
- TypeScript + Vite, bundled to `dist/`. Hosted on The Forge (no local Foundry install exists).

### 4.2 Map
Every hex has a **terrain type**, a **region** (or none), **UC terrain elements**, and may hold **landmarks**.
Terrain drives pace and DCs (§4.6, §4.8); there is no separate difficulty grade.

**Terrain types** are the Core Rulebook's overland terrains (CRB Table 7-8) plus three it lacks. Multipliers are
for highway / road or trail / trackless:

| Terrain | Highway | Road | Trackless | Getting-lost DC (CRB) | Wear die (trackless) |
|---|---|---|---|---|---|
| Desert, sandy | ×1 | ×½ | ×½ | 14 | d6 |
| Desert, rocky *(not in CRB; best guess)* | ×1 | ×1 | ×¾ | 14 | d4 |
| Forest | ×1 | ×1 | ×½ | 16 | d6 |
| Hills | ×1 | ×¾ | ×½ | 10 | d6 |
| Jungle | ×1 | ×¾ | ×¼ | 16 *(as forest)* | d8 |
| Moor | ×1 | ×1 | ×¾ | 10 | d4 |
| Mountains | ×¾ | ×¾ | ×½ | 12 | d6 |
| Plains | ×1 | ×1 | ×¾ | 14 | d4 |
| Swamp | ×1 | ×¾ | ×½ | 16 *(as forest)* | d6 |
| Tundra, frozen *(also ice)* | ×1 | ×¾ | ×¾ | 14 *(as plains)* | d4 |
| Settlement *(UC; best guess)* | ×1 | ×1 | ×1 | 8 *(CRB urban)* | d4 |
| Water *(UC)* | impassable in the MVP (boats are an idea) | | | — | — |

The wear die follows the trackless multiplier (×1 or ×¾ → d4, ×½ → d6, ×¼ → d8), the same steps that set the
Driver DC (§4.6). A step along a road or highway has no wear (§4.7).

Ultimate Campaign's Marsh is the CRB's moor (dry) or swamp (wet). Underground is out of scope.

**UC terrain elements** (Ultimate Campaign *Exploration*), the only hex tags:
- **Difficult** — pace one speed category slower (UC); Driver DC +5; the wear die one size larger (§4.7).
- **Feature** — a notable sight; shown once the hex is Explored.
- **Hunting Ground** — +2 on the day's encounter roll.
- **Resource** — Forager DC −2.
- **Secret** — hidden until the hex is fully explored (§4.10); exploration takes 50% longer.
- **Standard** — no effect.

**Regions** carry: a name and colour; an **encounter RollTable**; **default terrain and elements**, stamped onto hexes
painted into the region (ADR-0006); **resource-use modifiers** (multipliers on rations and water per day, e.g. a
desert's water ×2); an optional flat **DC modifier** for all roles or one role (KtP Stormlands: +5). Hexes outside
any region use the map's own defaults and rules (the same fields). Storm thresholds are gone.

**Landmarks** are named points on hexes (name, description, optional Font Awesome icon, known to the party or not).

**Routes are roads.** A route is a named, saved chain of adjacent hexes with a kind (**highway** or **road/trail**), a
colour, and known-to-the-party. Moving between two consecutive hexes of the same route uses that kind's multiplier;
any other step is trackless. Routes no longer carry days, difficulty, encounter bonuses, bargain effects or GM
prompts. The party can plot a course along a route to follow it.

**Existing maps migrate** on load (0.1.x data): difficulty, custom tags, per-hex encounter mods, storm thresholds
and route bargains, effects and prompts are dropped; old terrain labels map to the new list (dunes and desert →
sandy desert; badlands and canyon → rocky desert and mountains, with canyon also Difficult; scrubland and oasis →
plains, oasis also Resource; marsh → swamp; urban → settlement; road → plains). The GM reviews the result.

### 4.3 Knowledge and visibility
- Each hex is **Unknown / Explored / Mapped** for the party. On a travel day the **Cartographer** sets the hexes the
  caravan entered to Mapped on a success, Explored on a failure or when vacant. Knowledge never goes down.
- **Exploring** a hex to the end (§4.10) makes it Mapped and reveals its elements, Secret included.
- Players see terrain and elements only for Explored and Mapped hexes (Secret only once explored), and routes and
  landmarks only when known to the party. The GM sees everything.
- A **Mapped** hex gives the Navigator **+4** (the CRB bonus for a map).

### 4.4 The Caravan
The **Caravan actor** (module subtype `pf1-hexploration.caravan`) is what ties the party's travel together:
- **Travellers:** linked actors (PCs, NPCs, companions, animals). Each travels **in a vehicle seat or on foot**.
- **Vehicles:** linked pf1 `vehicle` actors. Each has a **Driver** slot (a traveller), a **Pulled by** team
  (draft animals among the travellers), **seats** and a **cargo capacity** (§4.7).
- **Party funds:** coin held on the Caravan actor (pp/gp/sp/cp). Players deposit from and withdraw to characters
  they own; wages and repairs are paid from it.
- **Roles** are set here (§4.5).
- **The token:** the Caravan actor's linked token is the party on the map; players may give it their own image.
  Its position is the caravan's hex.
- **Supplies live in the vehicles' inventories** (§4.9), not on the Caravan actor.

The Caravan sheet follows the 2026-10-29 rebuild mock-up (`../pf1e-hexploration/design/ui-mockups`,
FinalCaravan): a status line (activity, hex terrain and region, day), summary tiles (**Travellers**, **Speed** and
what sets it, **Food** and **Water** in days left with a running-low warning, **Cargo**, **Wages** a day, **Funds**),
a Travellers table (name, player, travels in, role with skill bonus, eats/day, wage, status: pf1 conditions such
as Fatigued), and a card per vehicle (speed, seats, cargo against capacity, HP and broken/wrecked, Driver and Pulled
by drop zones, warnings when undriven, under-teamed or overloaded). Drag actors or vehicles onto the sheet to add
them; drag a traveller onto a Driver or Pulled-by zone to assign them.

`hx.caravan` (ADR-0007) stays as the service for the sheet, canvas drops and agents, with the same `{ ok, … }`
results; its writes are no longer ledger entries (§4.13).

### 4.5 Roles and the daily roll
- **The seven KtP roles**, plus **a Driver for each vehicle**: Navigator, Scout, Forager, Driver (per vehicle),
  Wainwright, Cartographer, Healer/Cook.
- **Roles are sticky.** A holder keeps a role until they or the GM change it; nothing clears roles between days or
  trips except removing the holder from the caravan. Players set roles for characters they own; the GM sets any.
- **Every role rolls every day, automatically** (pf1 skill roll from the holder's sheet, no dialog), when the GM
  steps the day. The roller is the holder's best allowed skill. Players never press a roll button.
- **Two roles:** an actor may hold at most two, at **−4 on both** rolls.
- A **vacant** role counts as a failure. A role with no part in the day (the Navigator and Drivers on a day without
  movement) is not rolled.
- **On a road** the Navigator and the Drivers make **no check**: both succeed automatically (CRB: a road keeps most
  from getting lost; UCombat: out of combat a driver can take 10, and an easy road is the point of taking one).
- Results show at once: each role's total against its DC, success or failure, on the day's summary card.
- A roll pf1 returns with no readable total is reported to the GM by role and actor, and counts as a failure.

### 4.6 Role DCs and effects
DCs blend the KtP numbers with published rules (research in the appendix). A region's DC modifier adds to all.

| Role | Skills | DC | Success | Failure / vacant |
|---|---|---|---|---|
| **Navigator** | Survival, Profession (guide) | CRB getting-lost DC of the day's hex terrain **+4** (one roll stands for a day of hourly checks): moor/hill 14, mountain 16, desert/plains/tundra 18, forest/jungle/swamp 20, settlement 12. +4 to the roll in a Mapped hex. No check on a road. | — | **Lost:** no progress that day |
| **Scout** | Perception, Profession (scout) | 18 | Not surprised by the day's encounter | Surprised |
| **Forager** | Survival, Knowledge (nature), Profession (hunter) | 10 + 2 × (eaters − 1) (CRB Survival: feed one more per 2 points over 10); sandy desert +10 (CRB: harsh desert DC 20); Resource −2 | The party keeps one track (rations or water, the one shorter in days) undrained that day | — |
| **Driver** (each vehicle) | Handle Animal, Profession (driver) | 5 (UCombat, out of combat), **+5 for each step the terrain's trackless multiplier slows** travel (×1 → 5, ×¾ → 10, ×½ → 15, ×¼ → 20), Difficult +5. No check on a road (automatic success). | — | That vehicle takes one more wear die (§4.7) |
| **Wainwright** | Craft (carpentry), Profession (wainwright) | Moving: 15. Rest day: 10 (UCombat repair). | Moving: cancels the day's wear on every vehicle. Rest day: repairs 10 HP on one vehicle, using up 10 gp of **Repair Materials** (§4.9). | Moving: — . Rest day: repairs 5 HP, same materials. |
| **Cartographer** | Knowledge (geography), Profession (cartographer) | 15 | Hexes entered today become Mapped | They become Explored |
| **Healer/Cook** | Heal, Profession (cook) | 15 (CRB long-term care) | Up to six travellers get long-term care tonight (double natural healing), noted on the card | — |

### 4.7 Vehicles
Vehicles are **pf1 `vehicle` actors** linked to the Caravan; their own HP, hardness and broken state are the wagon's
condition (no separate track).
- **A Driver** is required: an undriven vehicle doesn't move (UCombat: "without a driver, a vehicle will not move"),
  so the caravan can't travel until it has one or is removed from the caravan.
- **Pulled by:** the team must meet the vehicle's requirement or it doesn't move. Defaults come from **Ultimate
  Equipment** (cart 2 Medium or 1 Large; light wagon 2M/1L; medium wagon 4M/2L; heavy wagon 8M/4L; two Medium count
  as one Large); the GM can set the requirement per vehicle.
- **Cargo:** the weight of the vehicle's inventory, plus any riders beyond its seats (their body weight by size —
  Small 40 lb, Medium 180 lb, Large ×8 of Medium… *(provisional)* — plus their carried load). Capacities default from
  Ultimate Combat (cart 300 lb, light wagon 1,000, medium 2,000, heavy 4,000) and are set per vehicle. Seats are
  set per vehicle (default: cart 2, wagons 4, carriage 4 per UCombat).
- **Overload (house rule; no RAW exists):** over capacity, the vehicle moves at **heavy-load** pace (CRB: 30 ft →
  20 ft, 20 ft → 15 ft); over **twice** capacity it can't move.
- **Wear:** every vehicle that moves off-road takes **one wear die** a day, sized by the terrain of the hex it ends
  the day in (§4.2: d4 for gentle ground such as plains, moor or rocky desert, d6 for forest, hills, mountains, swamp
  or sandy desert, d8 for jungle; Difficult one size larger, up to d10). A failed (or vacant) Driver adds **one
  more die of the same size** to their vehicle. The damage goes to the vehicle's HP and ignores hardness. A day spent
  on a road or highway deals **no wear** (and its Drivers don't roll, §4.5). A Wainwright success on a moving day cancels
  that day's wear on every vehicle.
- **Broken** (more than half HP lost, UCombat) halves the vehicle's pace; **wrecked** (0 HP) stops it.

### 4.8 Pace and movement
- **Pace** is the slowest of: each vehicle that moves (its overland speed: CRB 16 miles/day for carts and wagons,
  or its pf1 land speed, then broken and overload adjustments), and each traveller **on foot** (CRB overland from
  land speed: 15 ft → 12 mi, 20 ft → 16, 30 ft → 24, 40 ft → 32, 50 ft → 40; heavy load slows them too). Riders and
  pulling animals don't set pace. The sheet's Speed tile says what sets it.
- **Whole hexes only.** A travel day moves the caravan a whole number of hexes, **at least one**: pace (miles) × the
  multiplier of the first step (highway / road / trackless, §4.2) ÷ **12** (UC hexes), rounded down, minimum 1.
  Difficult counts as one speed category slower. There is no partial progress: the token always sits in a hex, and
  a plotted course of N hexes takes at most N travel days. Examples: a wagon (16 mi) makes 1 hex a day almost
  everywhere; a 30-ft party on foot (24 mi) makes 2 on a highway or a road across plains, 1 elsewhere; mounts at
  40–50 ft make 2–3 on good ground.
- A failed Navigator makes no progress that day (the caravan spends it finding its way back).

### 4.9 Supplies, drain and wages
- **Rations and Water** are summed from items in the **vehicles' inventories** flagged `supply: rations | water`;
  flagged pf1 containers count their contents (ADR-0005). Unit = one person-day. Drain uses loose supplies first,
  then container contents, in whole items (TD-0004).
- **Daily use** per traveller follows **PF1 gear-weight size multipliers**, the same for food and water: Tiny or
  smaller ×1/10, Small ×½, Medium ×1, Large ×2, Huge ×5, Gargantuan ×8, Colossal ×12. Constructs and undead
  eat nothing. Per-actor overrides. The region's resource-use modifiers multiply the day's rations and water.
- **Wages:** each traveller has a daily wage, default none for PCs; hirelings default to the CRB rates (trained
  **3 sp**, untrained **1 sp**), specialists set in gp (UC managers earn 2–5 gp). Wages are paid from party funds
  every day; if funds fall short, what can be paid is paid and the GM is whispered.
- **Repair Materials:** items in the vehicles' inventories named "Repair Materials" or flagged `supply: repair`
  (a flagged container counts its contents), valued at their pf1 price. A Rest-day repair uses up 10 gp of them
  (UCombat: 10 gp of raw materials), in whole units; with less than 10 gp aboard there is no repair. Repairs never
  take party funds.
- **Every day** (moving or not) drains supplies, pays wages and makes the encounter roll.

### 4.10 Activities
The party chooses one activity at a time; the plan is shared and anyone in the party can edit it.
- **Travel** — follow a course to a destination. Courses are plotted on the canvas (click a destination; add
  waypoints; adjacent hexes from the caravan) or picked from known routes. **A course needs GM approval**; changing
  it later needs approval again. A travel day moves the caravan (§4.8) and rolls every role.
- **Explore** — stay in the caravan's hex until it is fully explored, taking **UC's exploration time** by pace and
  terrain (days for plain/hill · desert/forest/marsh · mountain: 15 ft 3·4·5, 20 ft 2·3·4, 30 ft 1·2·3,
  40 ft 1·1·2, 50 ft 1·1·1; other terrains use their nearest UC type; Secret ×1.5, rounded up). On the last
  day the hex becomes Mapped and its elements are revealed. *(UC as written for now; the owner may home-brew it.)*
- **Forage** — stay one day; the Forager rolls with the day's yield doubled: on a success the party keeps **both**
  tracks undrained.
- **Rest** — stay one day; the Wainwright makes the rest-day repair (with Repair Materials); the Healer's long-term care applies.
- On a day without movement, Navigator and Drivers don't roll and no wear applies.

### 4.11 Encounters
- Each day: **d20 + day of the trip + 2 if the hex is a Hunting Ground**, looked up on the region's (or map's)
  RollTable, whose ranges include "nothing". The Scout's result decides surprise. The result is whispered to the GM,
  who decides whether to run it; the public summary card says only whether the party was surprised by anything.

### 4.12 Distribution and campaign content
- Public GitHub repo; each version tag builds a release with `module.json` and `module.zip`. Forge installs
  from the release manifest URL.
- The module ships no campaign content beyond the default roles. KtP's data (the Stormlands region and its routes,
  the Solaar landmarks) is a **separate world pack** kept outside this public repo.

### 4.13 Operators and undo
- **Players** (each a request the active GM's client validates and applies, invariant 2):
  - edit the roster with actors and vehicles they own — add, remove, seat, drive, pull (applied at once; the GM is
    whispered, since it changes daily use);
  - set roles for characters they own (applied at once);
  - deposit and withdraw party funds to and from characters they own (applied at once; the GM is whispered);
  - choose the activity and plot a course or pick a route (a course is **held for GM approval**).
- **The GM** approves or rejects courses, steps the day (**Next Day**), runs the whole course (**Travel all**,
  which stops early when an encounter result is not "nothing" or a vehicle can't move), stops a trip, and edits
  anything.
- **Undo:** only the **last day step** can be undone. Before each day the module snapshots what the day changes
  (supply item quantities, vehicle HP, party funds, map knowledge, caravan position and token, the plan, world
  time); Undo restores it once. Roster, role, fund and plan edits are not undoable; the GM fixes them by hand.

### 4.14 Provisional defaults (owner to confirm; see ROADMAP Chores)
- Rider body weights by size for cargo (§4.7), default seats per vehicle, and Small/Medium team equivalence.
- Wear dice by terrain (d4/d6/d8, Difficult one size up) and no wear on roads even when the Driver fails (§4.7).
- Forager success keeps the shorter track (in days) undrained; Forage keeps both (§4.6, §4.10).
- Navigator failure costs the day's progress (§4.8).
- Rocky desert and settlement multipliers, and the getting-lost DCs borrowed for jungle, swamp and tundra (§4.2).
- The terrain migration table for 0.1.x maps (§4.2).

## 5. Load-bearing invariants

1. **Hidden truth never reaches players.** GM-only state (terrain and elements of hexes the party hasn't explored,
   unknown routes and landmarks, region tables, encounter results) is never rendered in a player's UI or canvas
   nor sent in any player-visible message. Scene and actor flags are readable by every client, so this is
   "never rendered, never sent" (§6).
2. **The GM is the only writer.** Player clients only send requests. The active GM's client validates every
   request and performs every world-state write.
3. **The rules engine is pure and seeded.** Engine code has no Foundry or pf1 globals and takes an injected
   roller, so every day's outcome is reproducible and unit-testable.
4. **The last day step is undoable.** Each day step snapshots everything it changes so the GM can roll it back.

## 6. Accepted residuals

- **Invariant 1 is "never rendered, never sent" ([ADR-0002](./DECISIONS.md)).** A client-only Foundry module has no
  player-unreadable world storage: the scene's map flag and the caravan's flags are readable from a player's
  browser console. The module guarantees GM truth is never rendered in a player's UI or canvas (every player-facing
  render uses `store.partyView()` or a GM-only branch) and never sent in a player-visible message.
- **Public DCs can hint at terrain.** The summary card shows each role's DC (owner's choice). A DC computed from a
  hex the party hasn't explored hints at its terrain or region modifier; accepted as minor.

## Appendix — decision log

**Research (2026-10-25): how the KtP rules relate to published PF1e rules.**
- *Jade Regent Player's Guide, Caravans*: travellers hold jobs (Cook, Driver, Guard, Guide, Healer, Scout,
  Trader, Wainwright…) that give passive bonuses; the caravan rolls as one entity. Supplies are cargo units.
- *CRB*: getting lost is an hourly Survival check; forced march is a Con check DC 10 +2 per extra hour; Survival
  feeds one more person per 2 points over DC 10; very hot climates need 2–3× water.
- *Ultimate Campaign, Exploration*: 12-mile hexes, misdirection when lost, a daily encounter check, hex terrain
  elements, 100 XP per explored hex.
- *Ultimate Wilderness, Foraging*: DCs standard 15 / barren 20 / abundant 10, rugged +5 (for supplies, not food).

**MVP rework (2026-10-29, [ADR-0008](./DECISIONS.md)).** Owner's choices, and the research behind the numbers:
- *Why rework:* maintenance load, live fragility, clicks at the table. Strip this repo in place; the rebuild in
  `../pf1e-hexploration` is a source of UI ideas only.
- *Daily rolls replace one roll per leg* (one bad roll ruined a leg; roads were a liability). Roads earn their keep
  through RAW: CRB road multipliers, "following an obvious road … prevents most from becoming lost", no check for
  driving, and no terrain wear.
- *Published DCs found* (vs KtP): getting lost CRB 8–16 hourly (KtP Navigator 18 daily); UCombat driving DC 5 out of
  combat (KtP 15); UCombat repair DC 10, 10 gp, 10 HP / 5 HP on failure (KtP 15); Heal long-term care DC 15, six
  patients (KtP 18); Forager formula equals CRB Survival; no RAW DC for scouting (opposed Perception; Jade Regent
  ambush DC 20) or mapping (nearest Knowledge (geography) DC 15).
- *Vehicles (RAW):* UCombat — a creature pulls vehicle squares equal to its space at up to twice its speed; broken
  above half HP lost, wrecked at 0, destroyed at −squares; drivers use Handle Animal or Profession (driver). UCombat
  cargo: cart 300 lb, light wagon 1,000, medium 2,000, heavy 4,000; only the carriage lists passengers (4). UE and
  UCombat disagree on team sizes; UE chosen. **No RAW for overloading** in CRB, UCombat, UW or UC (nor UE); the
  heavy-load rule is a house rule built on CRB carrying capacity.
- *Wages (RAW):* CRB hirelings 3 sp trained / 1 sp untrained a day; UC managers 2–5 gp a day; UC teams are a
  one-off cost; Jade Regent monthly wages found only second-hand (not used); no rule on shared party funds.
- *Sources:* aonprd.com Rules ID 290 (getting lost), 1108 and 1111 (vehicles), 2400 (foraging); CRB environment and
  movement; UC exploration (legacy.aonprd.com/ultimateCampaign/campaignSystems/exploration.html); UE wagons;
  d20pfsrd caravans.

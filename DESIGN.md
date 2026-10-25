# DESIGN — Canonical Specification & Decision Log

The single source of truth for **why this project is the way it is**. Pre-implementation decisions live
here; decisions made *during* the build are appended as ADRs in [DECISIONS.md](./DECISIONS.md).

Source: a design interview with the owner on 2026-10-25, generalising the caravan-role travel system and the
Stormlands bargain routes from his *Keys to Perfection* (KtP) campaign.

---

## 1. Problem & goals

Long overland travel in Pathfinder 1e is either hand-waved or buried in hourly checks (getting lost, forced
march, heat, thirst). KtP's home-brew caravan system fixed that at the table: every PC takes a **caravan role**,
rolls **once per route leg**, and the result echoes across every day of the leg, draining shared **Rations,
Water and Wagon Condition**. The Stormlands added **routes offered as bargains** (fast but destructive, slow but
supplied, moderate but exposed). Today all of it lives in Notion tables and the GM's head.

**North star:** a Foundry VTT module that runs that system as **hexploration**: the GM paints a hex map, the
party musters roles for a leg, rolls from their own sheets, and the GM steps the caravan day by day while the
module applies drain, conditions, encounters and map knowledge, with every step undoable.

## 2. Scope (in / out)

**In (v1 = the milestones in ROADMAP.md):**
- Foundry **v13**, the **pf1** system only (pf1 11.11 declares Foundry 12–13, verified 13).
- Hex map authoring on the scene's native hex grid, **drawn by the module** (no background image needed).
- Landmarks, named routes (bargains), off-route plotted legs.
- A **Caravan** actor: roster, cargo hold, resource tracks, wagon.
- Data-driven caravan **roles**, the **Muster** window, chat-card rolls, GM day stepping.
- Party knowledge: Unknown / Explored / Mapped hex states and GM **reveal tags**.
- The Storm: drift, Navigator misdirection, heat, NPC/animal morale, linked pf1 vehicle.
- Distribution from a public GitHub repo (release manifest URL), installed on **The Forge**.

**Out:**
- Other game systems (no system-agnostic layer).
- Caravan-scale combat and the Jade Regent trade economy.
- PC morale (morale is NPCs and animals only).
- Campaign content inside the module: KtP's roles, routes and regions are a **separate world pack**
  (§4.12), not module code.
- Foundry v14 (pf1's development branch already requires it; the code stays v14-ready, §4.1).

## 3. Architecture overview

| Layer | Responsibility | Foundry dependency |
|---|---|---|
| **Engine** (`src/engine/`) | Pure rules: leg resolution, DCs, drain, saves owed, encounter lookup, drift, ledger diffs. Takes data + an injected roller; returns results. | **None** (invariant 3) |
| **Model** (`src/model/`) | TypeDataModels for the Caravan actor subtype and supply items; hex/route/landmark/tag records. | DataModel API |
| **Store** (`src/store/`) | Where each piece of state lives: party-visible vs GM-only truth (invariant 1). | Documents, settings |
| **Authority** (`src/authority/`) | Socket request channel: players request, the active GM validates and writes (invariant 2). | Sockets |
| **Adapters** (`src/pf1/`) | pf1 skill/save rolls, conditions, actor size and creature type, vehicle actor. | pf1 public API |
| **Canvas** (`src/canvas/`) | Hex terrain layer, GM brush toolbar, landmark/route rendering, caravan token movement. | Canvas, grid |
| **UI** (`src/ui/`) | Muster window (with map), Caravan sheet, GM travel console, chat cards. | ApplicationV2 |
| **Ledger** (`src/ledger/`) | Every automated change as an undoable entry (invariant 4). | Store |

**One leg, end to end:** the GM opens a leg → the Muster window shows each user the routes they know on a map →
players claim roles (requests), the GM approves the plan → roll prompts go out as chat cards → the engine
resolves the leg (length, outcomes) → the GM presses **Next Day** repeatedly: the caravan token advances one
hex, drain applies per eater, saves are prompted, conditions applied, that hex's encounter check fires, world
time advances one day, a ledger entry is written → on arrival, drift (later milestone) resolves.

## 4. Key design decisions

### 4.1 Platform
- Foundry **v13**: `compatibility.minimum 13`, `verified 13`. pf1 is a required system relationship (≥ 11.11).
- Written with ApplicationV2, TypeDataModel and the v13 canvas/grid APIs; nothing deprecated in v13, so the
  v14 bump is small.
- TypeScript + Vite, bundled to `dist/`. Hosted on The Forge (no local Foundry install exists).

### 4.2 Map
- **Hybrid:** every hex has terrain, difficulty (Easy/Standard/Hard/Brutal), region and tags. **Named routes**
  are pre-drawn chains of hexes with days, difficulty, encounter bonus and bargain text.
- **Off-route legs** are hex paths the party plots to any hex, at 1 hex/day, approved by the GM. The leg ends at
  the last hex, not only at landmarks. (1 hex/day fits CRB wagon speed 16 mi/day against 12-mile hexes.)
- Built-in hex tags from **Ultimate Campaign** terrain elements: Difficult, Feature, Hunting Ground (raises the
  encounter bonus), Resource (lowers the Forager DC), Secret (a site behind a check), Standard. The GM adds
  custom tags alongside.
- The GM authors with a **brush toolbar** on the scene's hex grid; the module renders terrain and landmarks
  itself.
- **Defaults are stamped on creation** (ADR-0006): a region's defaults (terrain, difficulty, tags, encounter mod)
  apply to hexes painted into it, else the map's defaults for region-less hexes. Hexes outside any region follow the
  map's own travel rules (DC mods, encounter table, water, storm threshold). The GM can re-stamp all region-less
  hexes from the map defaults on request.

### 4.3 Knowledge and visibility
- Each hex is **Unknown / Explored / Mapped** for the party. The Cartographer result sets Explored or Mapped;
  a route wholly through Mapped hexes travels with **no roll**.
- **Reveal tags:** the GM tags a set of hexes/routes ("Nomad Lore") and enables the tag to reveal them all at
  once. A tag can link to an **item** (a knowledge source such as a map) or an **actor** (character lore).
- **Actor-linked lore is owner-first:** only that character's owner sees it until they press **Share** (or the
  GM does); then the party sees it.
- Players see routes only according to their knowledge.

### 4.4 Legs and roles
- A **caravan block is one route leg** (landmark to landmark on a named route, or one plotted off-route path).
- **Roles are data-driven records:** allowed skills, base DC or DC formula, and success/failure effects chosen
  from a menu (add days, drain or preserve a track, set map state, impose a save, surprise). Regions and terrain
  add DC modifiers. The module ships the seven KtP roles as defaults: Navigator, Scout, Forager, Driver,
  Wainwright, Cartographer, Healer/Cook.
- Each role rolls **once per leg**; its consequences repeat every day of the leg. Navigator and Driver failures
  add +1 day once.
- **Who fills roles:** PCs, GM-run party members and companion/NPC actors on the roster, each rolling its own
  skills. One actor may hold **two roles** with a configurable penalty applied to **both** rolls.
- **Leg DC** comes from the route's declared difficulty (off-route: the hardest hex on the path). **Daily
  drain and the encounter table** come from the hex the caravan is in that day.
- **Forager DC = 10 + 2 × (eaters − 1) + terrain/region modifiers.** This is CRB Survival's "feed one more per
  2 points" rule; today's party of seven lands at 22, KtP's existing DC.

### 4.5 Operators and automation
- **Players** see and change roles when a leg is mustered, plot off-route paths, and share lore. Everything
  else is automatic or approved/overridden by the GM.
- **Applied automatically:** resource drain, pf1 conditions (Fatigued/Exhausted), map-state changes, leg
  length.
- **Forced-march saves** prompt each player for their own character; NPCs and GM-run members auto-roll.
- The GM **steps day by day** (Next Day), with room to stop and play a scene mid-leg. Each day advances core
  world time by one day (`game.time.advance`).

### 4.6 Resources
- A module **Caravan actor subtype** holds the roster, role assignments, position, tracks and a **cargo hold**
  (a real inventory).
- **Rations and Water are summed from hold items** flagged `supply: rations | water` (Jade Regent cargo-unit
  style). Buying, looting, trading and losing supplies are ordinary item operations; drain decrements item
  quantities. Track unit = one person-day.
- **Containers hold bulk stock** (ADR-0005): flag a pf1 container (a ration crate) and everything inside it counts
  toward that track. Drain uses loose supplies first, then container contents; quantities are always whole numbers
  (pf1 zeroes non-integer quantities).
- **Drain scales by eaters.** Each roster member eats and drinks by **PF1e gear-weight size multipliers**,
  the same for food and water: Tiny or smaller ×1/10, Small ×½, Medium ×1, Large ×2, Huge ×5,
  Gargantuan ×8, Colossal ×12 (CRB *Armor for Unusual Creatures*). Constructs and undead default to 0. Per-actor
  overrides.
- **Landmark resupply** is ordinary trade into the hold; landmark "services" are offers, not special code.

### 4.7 Wagon and animals
- **Wagon Condition** is a 0–max track on the Caravan (travel wear). Upgrades that raise the max are hold items.
- **Optionally linked pf1 `vehicle` actor** for combat and chases. The layers stay separate, with two bridges:
  Condition 0 gives the vehicle the broken condition; a destroyed vehicle sets Condition to 0.
- **Draft animals** are roster actors (they eat and drink by size). The wagon has a required draft count; below
  it, legs take extra days.

### 4.8 Encounters
- Each travel day: **d20 + journey day + route/hex encounter bonus**, looked up on the **region's RollTable**
  (ranges include "nothing"). A region can set a storm threshold (KtP: ≥ 30, the storm reaches for them).
- The Scout result decides surprise. Results whisper the GM, who decides whether to run them.

### 4.9 Route bargains
- Each named route carries a **structured effect menu** (replenish, extra drain, DC modifier, set map state,
  apply condition) plus **GM prompts**: free text triggered on a role's success/failure or a day number,
  whispered to the GM at that moment (e.g. Echoing Dunes: on Navigator success, ask a player for a memory).

### 4.10 The Storm (later milestones)
- **Drift** can change hex terrain and difficulty, decay Mapped hexes, open and close routes, and move
  landmarks. It triggers **once per leg on arrival** and from **encounter results**. Players see only that a
  hex **has shifted**, not how, until contact.
- **Navigator failure** = +1 day by default; a region can switch to Ultimate Campaign misdirection (the
  caravan secretly drifts into a different hex; players find out on contact).
- **Heat bands** per region (Warm / Very hot / Severe) multiply water drain ×1/×2/×3 and, at Very hot or above,
  each traveler makes one Fort save per day (DC 15 +1 per consecutive hot day) or takes nonlethal damage and
  Fatigued. Mitigations (shade, endure elements, desert gear) are actor/item flags.
- **Morale (NPCs and animals only):** low morale gives penalties on role rolls, then refusing roles (an animal
  won't pull, so it stops counting toward the draft requirement), then desertion.

### 4.11 Distribution
- Public GitHub repo; each version tag builds a release with `module.json` and `module.zip`. Forge installs
  from the release manifest URL.

### 4.12 Campaign content
- The module ships no campaign content beyond the seven default roles. KtP's data (roles at current DCs, the
  Stormlands region, the bargain routes, the Solaar landmarks) is a **separate world pack**, also the test data
  for the first full leg. By default it lives **outside this public repo** (in the owner's campaign repo), so
  campaign material is not published.

### 4.13 Provisional defaults (owner to confirm; see ROADMAP Chores)
These came up in the interview but were not settled. The build uses these until the owner overrides them.
- **Storm DCs:** a region carries a per-role DC modifier; the KtP Stormlands default is **+5 to every role**
  (matches Driver 15→20 and Healer 18→23 in the KtP #20 prep).
- **Role claim conflicts:** the first claim holds; a second claim on the same role is a request the GM settles.
- **At zero:** KtP severity is kept and configurable per track (Water 0 → Exhausted + Con damage per day; Rations
  0 → Fatigued until fed, then Con damage). CRB is gentler (nonlethal damage + Fatigued); offered as an option.
- **Forced march:** a **Fort save, DC 10 + 2 per consecutive day** (the KtP #19/#20 rule, which mirrors the CRB
  Con-check formula). The save type is configurable.

## 5. Load-bearing invariants

1. **Hidden truth never reaches players.** GM-only state (true hex terrain after drift, misdirection, unrevealed
   tags and routes, unshared lore) is never stored anywhere a player client can read, nor sent in any
   player-visible message or UI. Scene and actor flags are readable by every client, so this decides where data
   lives.
2. **The GM is the only writer.** Player clients only send requests (claim a role, plot a path, share lore). The
   active GM's client validates every request and performs every world-state write.
3. **The rules engine is pure and seeded.** Engine code has no Foundry or pf1 globals and takes an injected
   roller, so every leg outcome is reproducible and unit-testable.
4. **Every day step is undoable.** Each automated change (drain, conditions, map state, world time) writes a
   ledger entry that the GM can roll back.

## 6. Accepted residuals

- **Invariant 1 is narrowed to "never rendered, never sent" ([ADR-0002](./DECISIONS.md)).** A client-only Foundry
  module has no player-unreadable world storage: world settings, scenes, actors and journal entries all reach
  every client. GM truth (the scene's `map` flag: secret tags, unknown routes with their effects and prompts,
  unknown landmarks, region tables and tuning) and the caravan/ledger flags on the caravan actor (leg plans, GM
  prompt texts, caravan snapshots) are therefore readable by a player who opens the browser console. The module
  guarantees that GM truth is **never rendered** in a player's UI or canvas (every player-facing render uses
  `store.partyView()` or a GM-only branch) and **never sent** in a player-visible chat message or whisper. Real
  secrecy would need a server-side component, which is out of scope.

## Appendix — decision log

**Research (2026-10-25): how the KtP rules relate to published PF1e rules.**
- *Jade Regent Player's Guide, Caravans*: travelers hold jobs (Cook, Driver, Guard, Guide, Healer, Scout, Trader,
  Wainwright…) that give passive bonuses; the caravan rolls as one entity. Supplies are cargo units (1 stores
  = 10 provisions, 5 gp). Source of the hybrid hold model (§4.6). No getting-lost or map rules.
- *CRB*: getting lost is an hourly leader Survival check (desert/plains DC 14, forest 16); forced march is a Con
  check DC 10 +2 per extra hour; Survival feeds one more person per 2 points over DC 10; very hot climates need
  2–3× water; heat above 90°F is an hourly Fort DC 15 +1.
- *Ultimate Campaign, Exploration*: 12-mile hexes, secret-hex misdirection when lost, a daily d% encounter check,
  hex terrain elements (§4.2), 100 XP per explored hex.
- *Ultimate Wilderness, Foraging*: DCs standard 15 / barren 20 / abundant 10, rugged +5. A template for per-hex
  Forager modifiers.
- What KtP adds: one roll per leg echoed daily; every PC rolls their own skill; fixed consequences; route bargains;
  two-tier map knowledge.

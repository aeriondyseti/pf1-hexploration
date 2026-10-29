# Roadmap

What is **committed and not yet being worked on**, in dependency order. Each item is a session-sized sprint with a
**Done-when** acceptance line; the `sprint-loop` builds from here only. When an item is done it **leaves this file**:
what it did goes into [CHANGELOG.md](./CHANGELOG.md). The sprint under way is in its own branch's PROGRESS.md (empty on
the trunk); new features not yet committed are in [IDEAS.md](./IDEAS.md); known problems in what exists are in
[TECH-DEBT.md](./TECH-DEBT.md).

Status: next · later. Each `§` cites the relevant [DESIGN.md](./DESIGN.md) section.

---

## Milestone 2 — The MVP rework

Cut the module back to its core and move its numbers onto published rules (ADR-0008; owner interview 2026-10-29).
Each sprint **removes the 0.1.x code its part replaces**, so nothing cut lingers. The table stays on 0.1.14 until
2.5 ships; 0.2.x releases before then are for live checks only. The 1.15 muster fixes are dropped (their muster is
replaced); its "unreadable roll" warning lives on in 2.4.

- **2.1 Map model** *(§4.2, §4.3)* — published terrain types with their multipliers and getting-lost DCs; UC terrain
  elements as the only tags; regions with encounter table, defaults, resource-use modifiers and a DC modifier;
  routes as highway or road hex chains; the painter, hex layer, tooltip and Hex View panel updated to match; 0.1.x
  maps migrated. Removes difficulty grades, custom tags and their icon overrides, per-hex encounter mods, storm
  thresholds, and route days, difficulty, encounter bonus, bargain, effects and prompts. *(next)*
  **Done-when:** the painter offers the §4.2 terrain list and the six UC elements and nothing else; a region saves
  rations and water multipliers and a DC modifier; a route saves as highway or road; a 0.1.x scene loads with its
  terrain mapped per §4.2 and no dropped field left in its data; a player's tooltip shows terrain and elements only
  for Explored or Mapped hexes and never a Secret element before the hex is explored.

- **2.2 Caravan and vehicles** *(§4.4, §4.7, §4.9)* — the Caravan sheet rebuilt on the rebuild's FinalCaravan
  mock-up: travellers (seat or on foot, role, eats/day, wage, status), vehicle cards (Driver, Pulled by, seats,
  cargo, HP), tiles, party funds; supplies summed from the vehicles' inventories; `hx.caravan` on the new model.
  Removes the Caravan actor's own hold, Wagon Condition, the draft flag and required draft count, and pack
  import/export. *(later)*
  **Done-when:** dropping a pf1 vehicle and three actors on the sheet links them; a player seats their own PC in the
  wagon and drags their horse onto Pulled by, and can't do either for an actor they don't own; a ration in the
  wagon's inventory shows in the Food tile, one in a PC's own pack doesn't; the wagon's card warns when undriven,
  under-teamed (UE defaults) or over cargo capacity, counting a rider beyond the seats as cargo; a player deposits
  5 gp from their character into party funds and withdraws it, and the GM is whispered each time.

- **2.3 Daily engine** *(§4.5–§4.11)* — the pure, seeded engine for one day: pace (slowest vehicle or walker,
  overload, broken), hexes moved by terrain and road, role DCs and results (doubling, vacancy, no Driver or
  Navigator check on roads, Mapped +4), drain with region modifiers, wages, wear, the encounter roll, Explore
  timing. Removes the leg engine (one roll per leg, forced march, at-zero conditions, the Mapped-leg and
  draft-shortfall rules). Closes TD-0003. *(later)*
  **Done-when:** unit tests cover every row of §4.6, the §4.8 pace rules (a walker slower than the wagon sets pace;
  a broken wagon halves it; 1.5× cargo gives heavy-load pace, 2.1× stops), whole-hex movement (a wagon makes 1 hex a
  day in trackless forest, never less; a 30-ft party on foot makes 2 on a highway), no Navigator or Driver roll on a
  road, wear of 1d4 on plains, 2d6 in forest with a failed Driver, 1d8 in a Difficult
  forest hex and none on a road, the §4.10 exploration table, and wages short of funds; the same seed gives the same
  day.

- **2.4 Trip flow** *(§4.5, §4.10, §4.13)* — the Travel window: choose an activity, plot a course on the canvas
  (players included) or pick a known route, GM approval, **Next Day** and **Travel all**, the daily auto-roll and
  summary card, the GM's encounter whisper, token movement, world time, and undo of the last day. Removes the
  muster (claims, roll buttons, resolve), the leg chat card, the mini-map and the multi-step ledger. Closes
  TD-0001. *(later)*
  **Done-when:** a player plots a three-hex course and it waits for the GM; on approval, Next Day rolls every filled
  role from its holder's sheet with no dialog, posts one card with each total, DC and result, moves the token,
  drains the wagon's rations, pays wages and advances the date; Travel all runs to the destination and stops early on
  an encounter; Undo restores the last day exactly and a second Undo does nothing; a roll with no readable total
  warns the GM with role and actor.

- **2.5 Explore, Forage and Rest** *(§4.10, §4.6)* — the three stationary activities: Explore's multi-day timing
  and reveal, Forage's doubled yield, Rest's Wainwright repair (10 gp from funds) and long-term care. Releases the
  MVP. *(later)*
  **Done-when:** exploring a forest hex at 30 ft takes two days and then shows the party its Secret element and marks
  it Mapped; a successful Forage day drains neither rations nor water; a Rest day with a successful Wainwright
  restores 10 HP to the wagon and takes 10 gp from party funds; Navigator and Drivers don't roll on any of them.

## Chores

Committed and nobody is doing them: the owner's own acts, and live checks of what is built. Not the loop's work
unless an agent can do one.

- **Live check on Forge after 2.2 and after 2.5** (owner): in the duplicate campaign world on the "Solaar Desert:
  Stormlands" scene, link a pf1 vehicle and the party to a Caravan and run three days with one player client;
  report console errors. Only a live world can confirm: pf1 vehicle actors holding inventory and containers; the
  vehicle's HP and broken state as pf1 exposes them; auto-rolling pf1 skills with no dialog; the socket passing the
  sender's user id.
- **Confirm the provisional defaults** in DESIGN §4.14 (owner).
- **Confirm ADR-0002** (owner): invariant 1 narrowed to "never rendered, never sent".
- **Re-make the KtP world pack** for the new model (owner): the Stormlands region (terrain defaults, water ×2,
  +5 DC), its routes as roads, the Solaar landmarks.
- **Local Foundry v13 test install** (owner provides the licence key and a timed Node.js download link): pf1 11.11,
  a hex-row test world, and a Playwright harness that runs a day as GM and player and fails on console errors.

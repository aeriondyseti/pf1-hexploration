# Roadmap

What is **committed and not yet being worked on**, in dependency order. Each item is a session-sized sprint with a
**Done-when** acceptance line; the `sprint-loop` builds from here only. When an item is done it **leaves this file**:
what it did goes into [CHANGELOG.md](./CHANGELOG.md). The sprint under way is in its own branch's PROGRESS.md (empty on
the trunk); new features not yet committed are in [IDEAS.md](./IDEAS.md); known problems in what exists are in
[TECH-DEBT.md](./TECH-DEBT.md).

Status: next · later. Each `§` cites the relevant [DESIGN.md](./DESIGN.md) section.

---

## Milestone 0 — Scaffold

- **0.1 Module skeleton, build and release** *(§4.1, §4.11)* — TypeScript + Vite project bundling to `dist/`;
  `module.json` (id `pf1-hexploration`, Foundry compatibility minimum/verified 13, required system `pf1` ≥ 11.11);
  Vitest; `tsc --noEmit` typecheck; GitHub Actions CI (typecheck, test, build) and a tag-triggered release workflow
  that attaches `module.json` and `module.zip` with correct `manifest`/`download` URLs. *(next)*
  **Done-when:** `npm run build` writes a loadable `dist/` containing `module.json`; `npm test` and `npm run
  typecheck` pass; CI is green on `main`; pushing tag `v0.0.1` produces a GitHub Release whose `module.json`
  manifest and download URLs resolve.

- **0.2 Test harness: Foundry and pf1 fakes, seeded roller** *(§3, invariant 3)* — a fake `game`/settings/
  sockets/documents layer and pf1 roll/condition fakes for integration tests; the `Roller` interface the engine
  takes, with a seeded implementation for tests and a Foundry `Roll` implementation for play. *(later)*
  **Done-when:** an integration test drives an adapter end to end against the fakes; the same seed gives the same
  rolls across runs; a lint/test rule fails if anything under `src/engine/` imports Foundry or pf1 globals.

- **0.3 GM authority channel and hidden-state store** *(§3, invariants 1–2)* — a socket request/response channel
  where players send typed requests and only the active GM validates and writes; a store that separates
  party-visible state from GM-only truth. First establish, with evidence, which Foundry v13 storage player clients
  cannot read. *(later)*
  **Done-when:** integration tests show a player request is applied only by the GM client and a malformed or
  unauthorised request is rejected; GM-only fields never appear in party-visible documents or messages; the
  storage choice and any residual (if no player-unreadable storage exists) are recorded as an ADR and, if needed,
  in DESIGN §6.

- **0.4 Ledger and undo** *(invariant 4)* — engine-produced diffs recorded as ledger entries in the store; GM
  undo of the most recent entry restores tracks, conditions, map state, token position and world time. *(later)*
  **Done-when:** tests apply a multi-part change and undo it back to an identical prior state; undo is GM-only;
  entries survive a reload.

## Milestone 1 — One full leg, end to end

- **1.1 Hex data model and painter** *(§4.2)* — per-hex records (terrain, difficulty, region, built-in Ultimate
  Campaign tags, custom tags); a module-rendered terrain layer on the scene's hex grid; a GM brush toolbar.
  *(later)*
  **Done-when:** on a blank hex-grid scene with no background image, the GM paints terrain, difficulty, region and
  tags; the layer renders them; they persist across reload; players see Unknown hexes as blank.

- **1.2 Landmarks and named routes** *(§4.2, §4.9)* — place landmarks on hexes; draw routes as hex chains with
  days, difficulty, encounter bonus, bargain text, the structured effect menu and GM prompts; plot and approve
  off-route paths. *(later)*
  **Done-when:** the GM creates a landmark and a three-hex route with an effect and a prompt; a player plots an
  off-route path that the GM approves; route and path data validate in tests; the leg DC follows route difficulty
  (off-route: hardest hex).

- **1.3 Caravan actor** *(§4.6, §4.7)* — the `pf1-hexploration.caravan` actor subtype: roster (eats/drinks by
  size and creature type, with overrides), cargo hold with supply flags, computed Rations/Water tracks, Wagon
  Condition track, required draft count; a Caravan sheet. *(later)*
  **Done-when:** adding a Medium PC, a Large camel and a construct gives daily drain 1 + 2 + 0; dragging supply
  items into the hold changes the tracks; the sheet shows roster, hold and tracks.

- **1.4 Roles engine** *(§4.4)* — data-driven role records with the effect menu; the seven default roles; doubling
  penalty on both rolls; Forager DC from mouths; region/terrain DC modifiers; pure leg resolution. *(later)*
  **Done-when:** unit tests cover success and failure of all seven roles, doubling, a vacant role, the Forager DC
  formula (7 eaters → 22) and region modifiers; resolution is deterministic for a seed.

- **1.5 Muster window and roll cards** *(§4.3, §4.5)* — an ApplicationV2 window for every user with a map of the
  routes that user knows; role claiming through the authority channel; GM plan approval; chat-card roll prompts
  that roll pf1 skills from each actor. *(later)*
  **Done-when:** two players claim roles, the GM approves, each player rolls from a chat card and the results reach
  the engine; a player never sees a route they do not know; a conflicting claim becomes a GM request.

- **1.6 Day stepping** *(§4.5, §4.8)* — GM Next Day: advance the caravan token one hex, drain per eater, forced-march
  save prompts, pf1 conditions, the encounter check against the region's RollTable, one day of world time, a ledger
  entry. *(later)*
  **Done-when:** a three-day leg stepped day by day drains the expected totals, prompts saves on a failed Healer,
  applies Fatigued on a failed save, whispers an encounter result to the GM, advances world time three days, and
  undoes cleanly one day at a time.

- **1.7 KtP world pack (test data)** *(§4.12)* — an importable pack with the seven roles at KtP's current DCs, the
  Stormlands region (+5 DCs), the eight bargain routes and the Solaar landmarks, kept outside this repo. *(later)*
  **Done-when:** importing the pack into a fresh world and running the Borrowed Oasis leg (3 days, Easy) reproduces
  KtP's expected drain and DCs; the module repo contains no KtP campaign content.

## Milestone 2 — Knowledge

- **2.1 Explored and Mapped states** *(§4.3)* — Cartographer results set hex states; routes through Mapped hexes
  skip rolls; party map shows only Explored/Mapped detail. *(later)*
  **Done-when:** a failed Cartographer marks the leg's hexes Explored, a success marks them Mapped, and the next leg
  along that route resolves with no roll.

- **2.2 Reveal tags and lore sharing** *(§4.3)* — GM tags hex/route sets and enables them; tags link to items or
  actors; actor-linked lore is owner-first with a Share action. *(later)*
  **Done-when:** enabling a "Nomad Lore" tag reveals its hexes to Sabrina's owner only; pressing Share reveals them to
  the party; disabling the tag hides them again; the GM always sees everything.

## Milestone 3 — The Storm

- **3.1 Drift** *(§4.10)* — drift effects (terrain and difficulty, Mapped decay, routes open/close, landmarks move)
  triggered per leg on arrival and from encounter results; players see "has shifted" until contact. *(later)*
  **Done-when:** a seeded drift changes a Mapped hex's terrain; the party map shows it as shifted with no detail;
  entering the hex reveals the new terrain; drift is undoable.

- **3.2 Navigator misdirection** *(§4.10)* — a per-region switch from +1 day to secret misdirection. *(later)*
  **Done-when:** in a misdirection region a failed Navigator moves the caravan into a different hex visible only to
  the GM until the party makes contact; elsewhere it adds +1 day.

- **3.3 Heat** *(§4.10)* — region heat bands, water multipliers, daily Fort saves, mitigations. *(later)*
  **Done-when:** a Very hot region doubles water drain and prompts a daily Fort save (DC 15 +1 per consecutive day);
  an actor with a heat mitigation flag is exempt.

## Milestone 4 — Wagon and companions

- **4.1 Linked pf1 vehicle** *(§4.7)* — optional vehicle link with the two bridges. *(later)*
  **Done-when:** Condition 0 gives the linked vehicle the broken condition; destroying the vehicle sets Condition 0;
  with no link, nothing changes.

- **4.2 Draft rule** *(§4.7)* — required draft count; missing animals add days. *(later)*
  **Done-when:** removing one of two required camels makes the next leg take the configured extra days.

- **4.3 NPC and animal morale** *(§4.10)* — morale track for NPCs/animals; penalties, refusals, desertion. *(later)*
  **Done-when:** lowering an NPC's morale through each threshold applies the role penalty, then blocks role claims,
  then prompts the GM with a desertion that removes the NPC from the roster when confirmed.

## Chores

Committed and nobody is doing them: the owner's own acts, and live checks of what is built. Not the loop's work
unless an agent can do one.

- **Choose a license** for the public repo (Foundry modules are commonly MIT). *(owner)*
- **Confirm the provisional defaults** in DESIGN §4.13 (storm DCs, claim conflicts, at-zero severity, forced-march
  save). *(owner)*
- **Live check on Forge after 0.1:** install from the v0.0.1 manifest URL in a v13 + pf1 world; the module enables
  without console errors. *(owner)*
- **Live check on Forge after Milestone 1:** run one KtP leg in a real world with at least one player client.
  *(owner)*

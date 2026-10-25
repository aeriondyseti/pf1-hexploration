# Decision Log (ADRs)

Lightweight Architecture Decision Records. One entry per **major** decision made during implementation —
something that constrains future work or deviates from / refines [DESIGN.md](./DESIGN.md). Append-only;
supersede rather than rewrite. Small/local choices don't need an entry.

**Entry template:**

```
## ADR-NNNN — <title>
- **Date:** YYYY-MM-DD   **Sprint:** <roadmap id>   **Status:** Proposed | Accepted | Superseded by ADR-XXXX
- **Context:** what forced the decision.
- **Decision:** what we chose.
- **Consequences:** trade-offs, what this locks in or rules out, follow-ups.
```

---

## ADR-0001 — Pre-implementation design decisions live in DESIGN.md
- **Date:** 2026-10-25   **Sprint:** (pre-build)   **Status:** Accepted
- **Context:** Foundational design choices were settled before any code was written. We need a single
  source of truth for those without duplicating them across docs.
- **Decision:** [DESIGN.md](./DESIGN.md) is the canonical record of all **pre-implementation** design
  decisions. This DECISIONS.md log starts from the **first build sprint** and records decisions made
  *during* implementation.
- **Consequences:** To understand "why is it this way," read DESIGN.md first, then scan ADRs here for
  changes/refinements made while building. If an implementation decision contradicts DESIGN.md, the ADR
  documents the deviation and DESIGN.md should be updated to match (with a pointer to the ADR).

## ADR-0002 — Invariant 1 means "never rendered, never sent" (no unreadable storage exists)
- **Date:** 2026-10-25   **Sprint:** mvp   **Status:** Proposed (owner to confirm)
- **Context:** Review found GM truth in the scene `map` flag and GM prompt text in the caravan and ledger flags,
  all readable from any client. Foundry sends world settings, scenes, actors and journals to every client, so no
  client-only storage is player-unreadable; moving data to a GM-owned journal or setting is not real secrecy.
- **Decision:** Keep GM truth where it is. Guarantee that it is never rendered to a player (partyView or GM-only
  branches) and never sent in a player-visible message. Record the gap in DESIGN §6.
- **Consequences:** A player who opens the console can read the map and prompts. Real secrecy needs a server
  component (out of scope). Any new player-facing render must keep going through `store.partyView()`.

## ADR-0003 — Travel rules settled while fixing the MVP review
- **Date:** 2026-10-25   **Sprint:** mvp   **Status:** Accepted
- **Context:** Several DESIGN rules had no mechanism in the MVP; the review asked for them.
- **Decision:**
  - **Arrival is a separate GM step.** After the last day the leg stays `underway` (dayIndex = totalDays) so owed
    forced-march saves can still be rolled; `arrive()` refuses while saves are owed.
  - **Wholly Mapped route (DESIGN §4.3):** every role resolves as a success at its DC with no roll.
  - **Short of draft animals (DESIGN §4.7):** +1 day per missing draft animal.
  - **Claim conflicts (DESIGN §4.13):** a player's claim on a held role whispers the GM and is refused; a GM claim
    reassigns the role (the old holder's roll is dropped).
  - **Doubling:** when a claim or release moves an actor across the 2-role line, that actor's rolls are dropped
    and must be rerolled with the right penalty.
  - **Day-to-hex spread:** floor(d*n/T)-1 (start hex when negative), so a lengthened leg enters its last hex only
    on the last day.
  - **Off-route proposals:** a module-local `proposePath` request (not in the `Request` union) that the GM approves
    from the Travel window.
- **Consequences:** The KtP tuning of the draft-animal penalty is the owner's call (ROADMAP Chores).

## ADR-0004 — The MVP is one consolidated sprint, released as v0.1.0
- **Date:** 2026-10-25   **Sprint:** mvp   **Status:** Accepted
- **Context:** The owner needed a playable MVP within an hour; Milestones 0 and 1 were eleven roadmap items.
- **Decision:** Build Milestones 0 and 1 together on one branch (`sprint/mvp`) with parallel layer agents against
  frozen contracts (`src/types.ts`, `src/contracts.ts`), one integration pass, one three-lens review and one fix
  pass. Release it as v0.1.0. The release is cut from the sprint branch's tag; the owner merges the PR into `main`.
- **Consequences:** One review covered the whole milestone instead of one per item. Behaviour that needs a real
  Foundry is unverified until the live check (ROADMAP Chores). No Foundry type package is used: Foundry and pf1
  globals are typed `any` (src/types/foundry-globals.d.ts).

## ADR-0005 — The Caravan is a module actor subtype; bulk supplies live in pf1 containers
- **Date:** 2026-10-25   **Sprint:** mvp   **Status:** Accepted
- **Context:** The owner prefers a dedicated Caravan actor type. pf1 11.11's actor proxy falls back to
  `ActorBasePF` for types it does not map (`CONFIG.Actor.documentClasses[type] ?? ActorBasePF`). pf1 also resets
  any non-integer item quantity to 0, so fractional or multi-unit stock needs another home.
- **Decision:** Declare `documentTypes.Actor.caravan` and register a small TypeDataModel and a Caravan sheet in
  `init`. Caravan state stays in JSON flags. The store returns the designated caravan, else the world's first
  caravan actor. Bulk stock goes in pf1 containers: a container flagged as a supply makes all its contents count;
  drain uses loose supplies first, then container contents, written through `updateContainerContents` and undone
  through it (the ledger keeps the container UUID and item id).
- **Consequences:** Every quantity written is a whole number. Exact fractional consumption (Small members) is
  deferred (TD-0004). Holding pf1 items on the base actor class needs the live check.

## ADR-0006 — Hex defaults are stamped on creation; region-less hexes follow map rules
- **Date:** 2026-10-25   **Sprint:** fix/roster-npc (v0.1.9)   **Status:** Accepted
- **Context:** The owner wants hexes created in a region to start from that region's rules, hexes outside any region
  to start from configurable map rules, and the GM to override either.
- **Decision:** Defaults are **copied into a hex when it is created** (the owner's choice over live inheritance):
  the region brush stamps the region's defaults, other brushes the map's, falling back to the current terrain brush.
  Changing defaults later does not touch existing hexes, except an explicit "Re-stamp region-less hexes". Travel
  rules for region-less hexes live in `MapData.rules`; `engine.effectiveMap` presents them as a synthetic region
  (`MAP_REGION_ID`) so the engine and controller treat them like any region. A region id with no region record is
  kept as is (no rules), matching the earlier behaviour.
- **Consequences:** Hex records stay self-contained (no inheritance lookups at draw time). Editing a region's
  defaults does not repaint its hexes; re-stamping regions is a possible follow-up.


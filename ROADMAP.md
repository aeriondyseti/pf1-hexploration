# Roadmap

What is **committed and not yet being worked on**, in dependency order. Each item is a session-sized sprint with a
**Done-when** acceptance line; the `sprint-loop` builds from here only. When an item is done it **leaves this file**:
what it did goes into [CHANGELOG.md](./CHANGELOG.md). The sprint under way is in its own branch's PROGRESS.md (empty on
the trunk); new features not yet committed are in [IDEAS.md](./IDEAS.md); known problems in what exists are in
[TECH-DEBT.md](./TECH-DEBT.md).

Status: next · later. Each `§` cites the relevant [DESIGN.md](./DESIGN.md) section.

---

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

- **Live check on Forge, v0.1.0** (owner): install from the manifest URL in the duplicate campaign world on the
  "Solaar Desert: Stormlands" scene (Hexagonal Rows, Odd); create a Caravan, import the KtP pack, run the Borrowed
  Oasis leg with one player client (claim, roll, resolve, Next Day ×3, Undo); report console errors. Things only a
  live world can confirm: the caravan subtype holding pf1 items and containers on pf1's base actor class; the socket
  passing the sender's user id (ADR-0002 note in DESIGN §6); the hex layer tinting tokens from `canvas.interface`;
  brush strokes also starting Foundry's selection rectangle.
- **Local Foundry v13 test install** (owner provides the licence key and a timed Node.js download link): pf1 11.11,
  a hex-row test world, and a Playwright harness that runs a leg as GM and player and fails on console errors.
- **Confirm ADR-0002** (owner): invariant 1 narrowed to "never rendered, never sent".
- **Confirm the provisional defaults** in DESIGN §4.13 and ADR-0003 (draft shortfall +1 day per missing animal;
  wholly Mapped legs auto-succeed every role). *(owner)*
- **Merge the `sprint/mvp` PR** into `main` (v0.1.0 was released from the branch). *(owner)*

# Roadmap

What is **committed and not yet being worked on**, in dependency order. Each item is a session-sized sprint with a
**Done-when** acceptance line; the `sprint-loop` builds from here only. When an item is done it **leaves this file**:
what it did goes into [CHANGELOG.md](./CHANGELOG.md). The sprint under way is in its own branch's PROGRESS.md (empty on
the trunk); new features not yet committed are in [IDEAS.md](./IDEAS.md); known problems in what exists are in
[TECH-DEBT.md](./TECH-DEBT.md).

Status: next · later. Each `§` cites the relevant [DESIGN.md](./DESIGN.md) section.

---

## Milestone 2 — The MVP rework

Done: sprints 2.1–2.5 shipped together as 0.2.5 on 2026-10-29 (see CHANGELOG.md). Nothing committed is left;
the next milestone comes from a `grooming` pass over IDEAS.md.

## Chores

Committed and nobody is doing them: the owner's own acts, and live checks of what is built. Not the loop's work
unless an agent can do one.

- **Run local-code-review on the 0.2.5 rework** (agent): 2.1–2.5 were built in one sitting before a game, with
  unit and integration tests but without the multi-agent review step; fix or log what it finds.

- **Live check on Forge, v0.2.5** (owner): in the duplicate campaign world on the "Solaar Desert:
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

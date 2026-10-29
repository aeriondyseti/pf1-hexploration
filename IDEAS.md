# Ideas

**New features that are not yet a firm commitment**: each needs more fleshing out, a spec, a talk or the owner's
answer first. Fixes, refactors and hardening of what exists go to [TECH-DEBT.md](./TECH-DEBT.md) instead. An idea
moves to [ROADMAP.md](./ROADMAP.md) only when the owner commits to it (a `grooming` pass); the `sprint-loop` never
builds from here.

Each entry: a bold title with who raised it and when, then its motivation, shape and constraints as far as they go,
and what it waits on.

Most entries below were committed milestones or built features before the MVP rework (ADR-0008, 2026-10-29) and were
moved here uncommitted. Their 0.1.x designs are in git history (DESIGN.md at tag v0.1.14) and may not fit the new
model as written.

## Platform

- **Foundry v14 support** (design interview, 2026-10-25).
  pf1's development branch already requires Foundry v14 (minimum 14.368); the released pf1 11.11 stops at v13.
  - **Shape**: bump `compatibility` to 14, move to any APIs v14 changes, re-run the live checks on Forge.
  - **Constraints**: The Forge must offer the pf1 release that supports v14 first.
  - **Waits on**: a pf1 release that declares v14.

## Travel rules

- **Enforced long rests between legs** (Kevin, 2026-10-25).
  Off charted roads the animals, not the party, set the pace: a caravan can only push so many days before it has to
  stop for a long rest.
  - **Shape**: on uncharted ground (any hex not Mapped), cap consecutive travel days by the vehicle and its team; at
    the cap the caravan must Rest (drain continues, encounter checks still roll) before travelling on. Spare draft
    animals raise the cap. Cap and rest length come from the vehicle and are tunable per region.
  - **Constraints**: roads are unaffected or use a looser cap; fits with the Pulled-by rule (DESIGN §4.7).
  - **Waits on**: the owner's numbers (base days per vehicle, bonus per spare animal, rest length).

- **Route bargains** (was built in 0.1.0, cut 2026-10-29). Routes offered as trade-offs (fast but destructive, slow
  but supplied): per-route effects (replenish, extra drain, DC modifier, set map state) and GM prompts whispered on a
  role's success or failure or a day number.
  - **Waits on**: whether roads (DESIGN §4.2) plus region modifiers already cover what the table needs.

- **Forced march and supply exhaustion** (was built in 0.1.0, cut 2026-10-29). Fort DC 10 +2 per consecutive day
  when the Healer fails; Fatigued/Exhausted and Con damage when rations or water reach zero (KtP or CRB severity).
  - **Waits on**: how they fit daily rolls.

- **Heat** (Milestone 4.3, moved 2026-10-29). Region heat bands (Warm / Very hot / Severe) multiply water ×1/×2/×3;
  at Very hot or above a daily Fort save (DC 15 +1 per consecutive hot day) or nonlethal damage and Fatigued;
  mitigations (shade, endure elements, desert gear) as actor/item flags.

- **Drift** (Milestone 4.1, moved 2026-10-29). The Storm changes hex terrain, decays Mapped hexes, opens and closes
  routes and moves landmarks, once per trip on arrival and from encounter results; players see only "has shifted".

- **Navigator misdirection** (Milestone 4.2, moved 2026-10-29). Per region, a failed Navigator secretly drifts the
  caravan into a different hex (UC misdirection) instead of losing the day.

- **NPC and animal morale** (Milestone 5.3, moved 2026-10-29). Low morale: role penalties, then refusing roles (an
  animal won't pull), then desertion confirmed by the GM.

- **Boats and water travel** (rework interview, 2026-10-29). Water hexes are impassable in the MVP; CRB Table 7-9
  gives boat speeds (raft 5 mi/day … galley 96), currents add or block.

## Knowledge

- **Reveal tags and lore sharing** (Milestone 3.2, moved 2026-10-29). The GM tags sets of hexes, routes and
  landmarks and enables a tag to reveal them; tags link to an item (a map) or an actor (lore, owner-first with a
  Share action).

- **Custom hex tags** (was built in 0.1.0, cut 2026-10-29). GM tags beyond the six UC elements, with icons.

## Player control

- **Request queue with per-action approval** (Milestone 2.1, moved 2026-10-29). A world setting per player action
  (auto or held) and a GM queue listing held requests with their senders. The MVP holds only courses.

- **Party map notes** (Milestone 2.5, moved 2026-10-29). Players pin short notes (text, optional icon) on hexes,
  shown on the map and tooltip behind a Hex View switch; authors edit their own, the GM deletes any.

- **Supply forecast** (Milestone 2.4, moved 2026-10-29). Days left at current use and a planned course's cost
  (enough, or short by N days), from party-visible data only; needs regions marked "known to the party".

- **Ready check** (rework interview, 2026-10-29; dropped from the MVP). Players mark ready on the plan; the GM sees
  who is.

## Tools

- **Multi-step undo ledger** (was built in 0.1.0, cut 2026-10-29). Undo for every automated and player change, back
  through several steps.
- **Travel mini-map** (was built in 0.1.0, cut 2026-10-29). The map inside the Travel window.
- **Pack import/export** (was built in 0.1.0, cut 2026-10-29). JSON import/export of regions, routes and roles for
  world packs such as KtP's.

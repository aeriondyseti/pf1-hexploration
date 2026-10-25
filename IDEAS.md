# Ideas

**New features that are not yet a firm commitment**: each needs more fleshing out, a spec, a talk or the owner's
answer first. Fixes, refactors and hardening of what exists go to [TECH-DEBT.md](./TECH-DEBT.md) instead. An idea
moves to [ROADMAP.md](./ROADMAP.md) only when the owner commits to it (a `grooming` pass); the `sprint-loop` never
builds from here.

Each entry: a bold title with who raised it and when, then its motivation, shape and constraints as far as they go,
and what it waits on.

- **Foundry v14 support** (design interview, 2026-10-25).
  pf1's development branch already requires Foundry v14 (minimum 14.368); the released pf1 11.11 stops at v13.
  - **Shape**: bump `compatibility` to 14, move to any APIs v14 changes, re-run the live checks on Forge.
  - **Constraints**: The Forge must offer the pf1 release that supports v14 first.
  - **Waits on**: a pf1 release that declares v14.

- **Enforced long rests between legs** (Kevin, 2026-10-25).
  Off charted roads the animals, not the party, set the pace: a caravan can only push so many days before it has to
  stop for a long rest.
  - **Shape**: on an uncharted leg (any hex not Mapped), cap consecutive travel days by the vehicle and its draft
    team; when the cap is reached the caravan must take a long rest (one or more days stationary: drain continues,
    no movement, encounter checks still roll) before the next leg can start. Draft animals beyond the required count
    raise the cap (spare animals share the load). The cap and rest length come from the vehicle (wagon type /
    linked pf1 vehicle) and are tunable per region.
  - **Constraints**: charted (Mapped) routes are unaffected or use a looser cap; the rest is a ledger step like any
    other day (undoable); fits alongside the existing draft-shortfall rule (ADR-0003: +1 day per missing animal)
    rather than replacing it.
  - **Waits on**: the owner's numbers (base days per vehicle, bonus per spare animal, rest length); the linked pf1
    vehicle (ROADMAP 4.1) and draft rule work (4.2) for where vehicle stats live.


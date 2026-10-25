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

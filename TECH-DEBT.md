# Tech Debt Ledger

**Known problems in what exists**, consciously not fixed now, so they're not lost: code-review findings that fell
below the action threshold or were deferred as out of scope, acknowledged shortcuts taken to keep a sprint focused,
and gaps worth revisiting. New features go to [IDEAS.md](./IDEAS.md), not here; a limit examined and accepted as it
is goes to DESIGN.md's "Accepted residuals".

**What to log here:** plausibly-real review findings we didn't work (e.g. confidence ~26–79), any ≥80 finding we
deliberately defer (with a reason), and intentional shortcuts. **Don't** log obvious false positives (confidence
≤ 25) or things a linter/typechecker already handles.

| ID | Date | Sprint | Source | Description | Conf./Severity | Why deferred | Suggested fix | When |
|---|---|---|---|---|---|---|---|---|
<!-- TD-0001 | YYYY-MM-DD | <sprint> | review (<dimension>) | ... | <conf>/<sev> | ... | ... | <the sprint or trigger that should take it> -->
| TD-0001 | 2026-10-25 | mvp | review (rules) | Players cannot plot an off-route path: the painter (and its Path tool) is GM-only, so the "Propose plotted path" button never shows for a player. The request, validation and GM approval exist. | 60/low | Opening a player-only Path mode in the painter is UI work beyond the MVP time box | Player course plotting on the canvas (DESIGN §4.10) | Sprint 2.4 (trip flow) |
| TD-0002 | 2026-10-25 | mvp | review (invariants) | Caravan state and the last-day snapshot are stored in caravan flags (readable from the console). | 85/high | Accepted as residual (ADR-0002): no storage is player-unreadable | If a server component ever exists, keep GM truth there | With any server-side work |
| TD-0003 | 2026-10-25 | mvp | review (rules) | `ResolveLegInput` has no knowledge or draft input; the wholly-Mapped and draft-shortfall rules live in `travel.resolveMuster` instead of the pure engine. | 70/low | Contract files were frozen for the parallel build | Superseded: the daily engine replaces the leg engine, with pace and Mapped rules inside it | Sprint 2.3 (daily engine) |
| TD-0004 | 2026-10-25 | mvp | owner | Supply drain rounds up whole items: a Small eater (½ person-day) or a multi-unit item over-consumes, and remainders are lost between days. | —/low | No Small party members yet; crates use pf1 containers of single rations | Keep an "opened stock" amount per track on the caravan: drain spends it first, opens whole items, carries the remainder; the day snapshot restores it | Sprint 2.3, or the first Small party member |
| TD-0005 | 2026-10-25 | mvp | build | No Foundry type package: Foundry and pf1 globals are `any`, so API misuse only shows up live. | —/medium | Typing v13 + pf1 would have cost more than the MVP time box | Adopt the League's Foundry v13 types (or hand-written interfaces for the APIs used) and type the adapters | With the local Foundry test install |

---

### Notes
- Add a row whenever the review (or development) surfaces something we don't fix in the current sprint.
- Reference the originating `reviews/<sprint-id>.md` when relevant.
- When a sprint fixes a row, the row goes (the fix is in CHANGELOG.md). Rows are re-checked against the code in a
  `grooming` pass: outdated ones go, features move to IDEAS.md, accepted limits move to DESIGN.md, and anything that
  has grown important is offered for ROADMAP.md.

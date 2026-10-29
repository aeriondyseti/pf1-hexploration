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
| TD-0002 | 2026-10-25 | mvp | review (invariants) | Caravan state and the last-day snapshot are stored in caravan flags (readable from the console). | 85/high | Accepted as residual (ADR-0002): no storage is player-unreadable | If a server component ever exists, keep GM truth there | With any server-side work |
| TD-0004 | 2026-10-25 | mvp | owner | Supply drain rounds up whole items: a Small eater (½ person-day) or a multi-unit item over-consumes, and remainders are lost between days. | —/low | No Small party members yet; crates use pf1 containers of single rations | Keep an "opened stock" amount per track on the caravan: drain spends it first, opens whole items, carries the remainder; the day snapshot restores it | The first Small party member or multi-unit supply item |
| TD-0005 | 2026-10-25 | mvp | build | No Foundry type package: Foundry and pf1 globals are `any`, so API misuse only shows up live. | —/medium | Typing v13 + pf1 would have cost more than the MVP time box | Adopt the League's Foundry v13 types (or hand-written interfaces for the APIs used) and type the adapters | With the local Foundry test install |
| TD-0006 | 2026-10-29 | 2-mvp-rework | review | Players' seat, driver and team changes apply without whispering the GM (add/remove and funds do). | 70/low | Time box before the game | Whisper the GM from the setSeat/setDriver/setTeam handlers when the sender isn't a GM | Next grooming |
| TD-0007 | 2026-10-29 | 2-mvp-rework | review | The Caravan **actor** sheet disables every control for players who don't own the caravan actor; the Caravan window (scene controls) works. | 60/medium | Time box; workaround exists | Render the actor sheet's controls by the viewer's ownership of each traveller, not of the caravan actor | Next grooming |
| TD-0008 | 2026-10-29 | 2-mvp-rework | review | Hireling wages default to 0; DESIGN §4.9 says CRB 3 sp trained / 1 sp untrained. | 72/low | Trained vs untrained can't be read from pf1; the GM sets wages on the sheet | Default NPC travellers to 1 sp, or a GM setting | Next grooming |
| TD-0009 | 2026-10-29 | 2-mvp-rework | review | Travel all reads `pace.blocked` as "the caravan can't continue"; harmless today (Travel all is travel-only) but brittle. | 75/low | Not reachable from the UI | Separate 'vehicle blocked' from 'trip can't continue' in DayOutcome | Next grooming |
| TD-0010 | 2026-10-29 | 2-mvp-rework | review | Clear course and plotting's Cancel ignore a refused setPlan; "Ask to stop" was fixed. | 50/low | Cosmetic | Toast the error like the other plan actions | Next grooming |
| TD-0011 | 2026-10-29 | 2-mvp-rework | review | setPlan's course check uses the GM's viewed scene grid, not the caravan's scene. | 50/low | Only differs when the GM views another scene | Validate against the caravan scene's grid | Next grooming |
| TD-0012 | 2026-10-29 | 2-mvp-rework | review | A missing or deleted encounter table counts as "no encounter", so Travel all keeps going. | 45/low | GM is whispered the total either way | Whisper a warning when the table UUID doesn't resolve | Next grooming |
| TD-0013 | 2026-10-29 | 2-mvp-rework | review | An invalid rations/water multiplier in the painter is silently saved as 1. | 45/low | Cosmetic | Refuse and toast invalid numbers | Next grooming |
| TD-0014 | 2026-10-29 | 2-mvp-rework | review | Role skills use bare parent ids ('pro', 'crf'): any Profession or Craft qualifies, not the one DESIGN names. | 45/low | Generous to players; bestSkill picks the highest | Name the subskills (Profession (driver), Craft (carpentry)…) once pf1 subskill keys are confirmed live | Next grooming |
| TD-0015 | 2026-10-29 | 2-mvp-rework | review | Deposit/withdraw writes the character's coins before the caravan save, with no rollback. | 40/low | Rare (a failed flag write) | Write the caravan first, or roll the coins back on failure | Next grooming |
| TD-0016 | 2026-10-29 | 2-mvp-rework | review | Undo silently skips supplies, tokens and vehicles it can't resolve, then reports success. | 40/low | Rare (deleted items between day and undo) | Report what couldn't be restored | Next grooming |
| TD-0017 | 2026-10-29 | 2-mvp-rework | review | 0.1.x map migration happens in memory on every read; the scene flag keeps the dropped fields until the next GM map write. | 35/low | Harmless (dropped fields are ignored) | Write the migrated map once on the GM's ready | Next grooming |
| TD-0018 | 2026-10-29 | 2-mvp-rework | review | The knowledge snapshot and the day's knowledge write can target different scenes when the caravan has no sceneId. | 35/low | Caravan placement always sets sceneId | Use one scene id for both | Next grooming |

---

### Notes
- Add a row whenever the review (or development) surfaces something we don't fix in the current sprint.
- Reference the originating `reviews/<sprint-id>.md` when relevant.
- When a sprint fixes a row, the row goes (the fix is in CHANGELOG.md). Rows are re-checked against the code in a
  `grooming` pass: outdated ones go, features move to IDEAS.md, accepted limits move to DESIGN.md, and anything that
  has grown important is offered for ROADMAP.md.

# Review — sprint 2-mvp-rework (v0.2.5)

- **Base:** 15741e7 (main) · **Head:** 912eaa4 · local-code-review workflow, 5 dimensions, 1 adversarial verifier per
  finding (time-boxed before a game). **Complete:** yes, 0 agent failures. 38 candidates → 3 actionable, 31 tech-debt.
- Full machine output: `reviews/2-mvp-rework.json`.

## Important (actionable, fixed)
1. `src/travel/index.ts` — Travel all could burn up to 60 days when the Navigator was vacant or kept getting lost
   (every role starts vacant on a migrated caravan). **Fix:** Travel all stops after any day without progress.
2. `src/ui/travel-app.ts` — choosing a hidden road (GM list) looked it up in the party view and silently cleared the
   course. **Fix:** look it up in the map the list was built from.
3. `src/store/index.ts` / player preview — players' previews used the party view (no region DC mods), so they showed
   DCs that differed from the rolled ones. **Fix:** players' previews show who rolls, not a DC (the card shows it).

## Fixed from the tech-debt list (cheap, could bite at the table)
- Approve re-checks that the course still starts at the caravan's hex.
- Rest-day repairs are skipped when funds can't cover them after wages (funds never go negative).
- Undo restores only what the day changed; roster, role and plan edits made since stay, funds get the day's delta.
- A vehicle with unreadable HP (maxHp 0) is neither wrecked nor broken (was: blocks all travel); broken now means
  more than half HP lost (DESIGN §4.7).
- Course-plotting clicks use stopImmediatePropagation so tokens/painter don't also receive them.
- "Ask to stop" reports a failed request.

## Deferred
TD-0006 … TD-0018 in TECH-DEBT.md.

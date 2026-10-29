# CLAUDE.md — Orientation & Operating Manual

**Read this first.** It exists so a fresh or compacted context can re-orient instantly and keep working
**autonomously** (including overnight). It's the anchor, not the spec — heavy detail lives in the docs below.

---

## What this project is

**PF1 Hexploration** (`pf1-hexploration`) is a Foundry VTT v13 module for the Pathfinder 1e (`pf1`) system that
runs caravan travel as hexploration. The GM paints a hex map of published terrain types, regions and roads; the
party links travellers and pf1 vehicles to a Caravan actor, sets sticky roles and plans an activity; the GM
approves and steps the days, and each day every role is auto-rolled at DCs drawn from published rules while the
module moves the caravan, drains the vehicles' supplies, pays wages, wears the vehicles, checks encounters and
updates map knowledge; the last day can be undone. It generalises the caravan-role and Stormlands travel systems
from the owner's *Keys to Perfection* campaign. **Milestone 2 reworks the 0.1.x build down to this MVP** (ADR-0008):
code that ROADMAP says a sprint removes is meant to go. The owner plays on The Forge; there is no local Foundry
install.

→ Full design rationale: **[DESIGN.md](./DESIGN.md)**.

## Document spine (single sources of truth)

| File | Role |
|---|---|
| **DESIGN.md** | Canonical *why* — full spec + pre-implementation decision log. Read for any "why is it this way." |
| **ROADMAP.md** | What is *committed and not yet worked on*, in dependency order, each item with a **Done-when** line; a Chores section for the owner's acts and live checks. An item leaves when its sprint merges. |
| **IDEAS.md** | New features *not yet committed* (they need a spec, a talk or the owner's answer). Never built by the loop; promoted to ROADMAP only by the owner (`grooming`). |
| **PROGRESS.md** | The sprint on *this branch* only: its branch, base and done-when checklist. **Always empty on `main`.** |
| **CHANGELOG.md** | Everything completed, Keep a Changelog format, one section per release. |
| **DECISIONS.md** | ADR log — append a numbered ADR for every *major* decision/deviation made while building. |
| **TECH-DEBT.md** | Known problems in what exists, consciously deferred, with reasons (accepted limits go to DESIGN.md's "Accepted residuals"). |
| **.claude/skills/local-code-review/** | The autonomous substitute for `/code-review` (sprint-workflow step 2). |

## Re-orienting after a context reset (do this every time)

1. Read this file. 2. Look for a sprint in progress (`git branch --list 'sprint/*' --no-merged main`): its
**PROGRESS.md** names the item and how far it got. 3. Otherwise open **ROADMAP.md** → the first committed item
(`next` first) and its **Done-when**. 4. Skim recent **DECISIONS.md** ADRs for anything that changed the plan.
5. `git log --oneline -15` and `git status` to see what's actually on disk. Then continue the loop.

---

## The sprint workflow (one feature at a time)

For each committed ROADMAP item, in order (on its own `sprint/<id>` branch, whose PROGRESS.md holds the branch,
its base and the Done-when as a checklist):

1. **Code it** autonomously to its Done-when line.
2. **Review it** — run the **local-code-review** skill (multi-agent self-review). This **satisfies the
   review gate** in self-paced/autonomous loops. The official `/code-review` is an optional stronger pass
   to run when convenient; it does not block sprint completion.
3. **Fix all** issues the review surfaces (not a subset). Re-review if fixes were substantial.
4. **Test it** — write **unit + integration** tests covering the feature's behavior and its Done-when.
5. **Record it**, on the sprint branch — add the release's section to **CHANGELOG.md** (Added/Changed/Fixed/…),
   **remove the item from ROADMAP.md**, **bump the version** (`module.json` and `package.json`) per the scheme
   below and tag on the merge commit, and append an **ADR** to DECISIONS.md for any major decision. If a choice
   contradicts DESIGN.md, update DESIGN.md and cite the ADR. **Log any unworked review findings to
   [TECH-DEBT.md](./TECH-DEBT.md)** (remove rows this sprint fixed); a new feature the work suggests goes to
   **IDEAS.md**. Last, **empty PROGRESS.md**, so `main` receives it empty.

An item is **done only when all five are done** (local-code-review counts) and PROGRESS.md is empty again.

When fixing review findings (step 3): work everything that meets the action bar; **any plausibly-real
finding you deliberately *don't* fix** (below threshold, or deferred as out-of-scope) goes into
**TECH-DEBT.md** with a reason — never just dropped. Obvious false positives (conf ≤ 25) need no entry.

## Autonomous-loop operating rules (overnight)

- **Branch lifecycle (one branch per sprint, no chaining):**
  - Commit per feature to its `sprint/<id>` branch as work progresses, message ending with the
    `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer. **Sprint branches stay local.**
  - When the sprint is **ready** (all 5 steps done, PROGRESS.md empty), **merge `sprint/<id>` into `main` with a merge
    commit** (`git merge --no-ff`), tag the merge commit `v<version>`, then **push `main` and the tag**
    (`git push origin main --follow-tags`; never force-push). Then **create the next sprint's branch from the
    updated `main`** (`git checkout main && git checkout -b sprint/<next-id>`). No branches-of-branches.
  - Never work directly on `main`; all feature work happens on a `sprint/<id>` branch off the latest `main`.
- **When blocked by ambiguity** DESIGN.md doesn't settle: make the most reasonable call, **log an ADR**, and
  **continue.** Don't stall the loop for resolvable choices.
- **The owner confirms before action outside the loop.** Inside a sprint the loop runs on its own; anything
  beyond the committed ROADMAP (new scope, changes to the owner's other repos, Notion or Forge) waits for an
  explicit go-ahead.
- **STOP the loop** (leave a clear writeup of state + reason; don't hack around it) when:
  - tests can't be made to pass after reasonable attempts (no hacks/skips to force green),
  - a decision is **high-impact / hard to reverse** (queue it for the user),
  - a **milestone completes** — pause for review of a coherent chunk, unless the user has explicitly started an
    autonomous run (overnight, or a long unattended one): then a milestone is not a stop,
  - the **same feature fails self-review repeatedly** without converging.
- **Never** fake green: no deleting/skipping tests to pass, no `--no-verify`, no silencing the project's
  load-bearing invariants to make something work.

## Load-bearing invariants (never violate)

1. **Hidden truth never reaches players.** GM-only state (true hex terrain after drift, misdirection, unrevealed
   tags and routes, unshared lore) is never stored anywhere a player client can read, nor sent in any
   player-visible message or UI. Scene and actor flags are readable by every client, so this decides where data
   lives. *(Narrowed in practice to "never rendered, never sent": a client-only module has no player-unreadable
   storage. See DESIGN §6 and ADR-0002.)*
2. **The GM is the only writer.** Player clients only send requests (claim a role, plot a path, share lore). The
   active GM's client validates every request and performs every world-state write.
3. **The rules engine is pure and seeded.** Engine code has no Foundry or pf1 globals and takes an injected
   roller, so every leg outcome is reproducible and unit-testable.
4. **The last day step is undoable.** Each day step snapshots everything it changes (supplies, vehicle HP, funds,
   map knowledge, position, world time) so the GM can roll it back (narrowed from "every step" by ADR-0008).

## Tech conventions

- **Targets:** Foundry VTT **v13** (`minimum`/`verified` 13) and the **pf1** system ≥ 11.11. Use ApplicationV2,
  TypeDataModel and the v13 canvas/grid APIs; nothing deprecated in v13 (keeps the v14 bump small).
- **Language/build:** TypeScript (strict) bundled with Vite to `dist/`; Foundry loads `dist/` only.
- **Layers** (DESIGN §3): `src/engine/` is pure (no Foundry/pf1 imports or globals); Foundry and pf1 calls live only
  in `src/pf1/`, `src/store/`, `src/authority/`, `src/canvas/`, `src/ui/`, `src/ledger/`.
- **pf1 access** only through its public API (actor rolls, conditions); never write pf1 system data paths directly.
- **Tests:** Vitest. Unit tests for the engine; integration tests run adapters against the Foundry/pf1 fakes in
  `test/fakes/`. Anything that needs a real Foundry becomes a "live check on Forge" Chore in ROADMAP.md.
- **Campaign content** (KtP roles, routes, regions) never goes in this repo (DESIGN §4.12).
- **Versioning:** version = `0.<milestone>.<feature>` (e.g. sprint 1.2 → `0.1.2`; Milestone 0 releases `0.0.x`).
  Single-sourced in `module.json`, mirrored in `package.json`; the release workflow checks they match the tag.

## Commands

- **Install/sync deps:** `npm ci` (`npm install` until a lockfile exists)
- **Run tests:** `npm test`
- **Typecheck:** `npm run typecheck`
- **Run the app:** `npm run build`, then install from the release manifest on The Forge (no local Foundry);
  `npm run dev` rebuilds `dist/` on change.

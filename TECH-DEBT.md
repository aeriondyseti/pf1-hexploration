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

---

### Notes
- Add a row whenever the review (or development) surfaces something we don't fix in the current sprint.
- Reference the originating `reviews/<sprint-id>.md` when relevant.
- When a sprint fixes a row, the row goes (the fix is in CHANGELOG.md). Rows are re-checked against the code in a
  `grooming` pass: outdated ones go, features move to IDEAS.md, accepted limits move to DESIGN.md, and anything that
  has grown important is offered for ROADMAP.md.

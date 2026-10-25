# Decision Log (ADRs)

Lightweight Architecture Decision Records. One entry per **major** decision made during implementation —
something that constrains future work or deviates from / refines [DESIGN.md](./DESIGN.md). Append-only;
supersede rather than rewrite. Small/local choices don't need an entry.

**Entry template:**

```
## ADR-NNNN — <title>
- **Date:** YYYY-MM-DD   **Sprint:** <roadmap id>   **Status:** Proposed | Accepted | Superseded by ADR-XXXX
- **Context:** what forced the decision.
- **Decision:** what we chose.
- **Consequences:** trade-offs, what this locks in or rules out, follow-ups.
```

---

## ADR-0001 — Pre-implementation design decisions live in DESIGN.md
- **Date:** 2026-10-25   **Sprint:** (pre-build)   **Status:** Accepted
- **Context:** Foundational design choices were settled before any code was written. We need a single
  source of truth for those without duplicating them across docs.
- **Decision:** [DESIGN.md](./DESIGN.md) is the canonical record of all **pre-implementation** design
  decisions. This DECISIONS.md log starts from the **first build sprint** and records decisions made
  *during* implementation.
- **Consequences:** To understand "why is it this way," read DESIGN.md first, then scan ADRs here for
  changes/refinements made while building. If an implementation decision contradicts DESIGN.md, the ADR
  documents the deviation and DESIGN.md should be updated to match (with a pointer to the ADR).

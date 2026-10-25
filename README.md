# PF1 Hexploration

A Foundry VTT **v13** module for the **Pathfinder 1e** (`pf1`) system that runs caravan travel as hexploration:
paint a hex map and named routes, muster caravan roles for each leg, roll once from each character's sheet, and step
the caravan day by day while the module applies drain, conditions, encounters and map knowledge — every step undoable.

## Install

In Foundry (or The Forge), **Install Module → Manifest URL**:

```
https://github.com/aeriondyseti/pf1-hexploration/releases/latest/download/module.json
```

Requires the `pf1` system 11.11 or later on Foundry v13.

## Develop

```sh
npm install
npm test          # unit + integration tests (Vitest, Foundry fakes)
npm run typecheck
npm run build     # bundles to dist/
```

Design: [DESIGN.md](./DESIGN.md) · Plan: [ROADMAP.md](./ROADMAP.md) · Orientation: [CLAUDE.md](./CLAUDE.md)

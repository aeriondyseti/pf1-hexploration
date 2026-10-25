# Changelog

All notable changes to PF1 Hexploration are recorded in this file.
The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/); versions follow `0.<milestone>.<feature>` (sprint 1.2 → 0.1.2).

## [Unreleased]

## [0.1.4] - 2026-10-25

### Added
- A GM "Place on map" button in the Caravan window puts the caravan's token on the viewed scene (at its recorded
  hex, or the view centre) and reports any error.

### Changed
- New caravans get a linked prototype token with no resource bars and the name shown on hover.

## [0.1.3] - 2026-10-25

### Fixed
- Roster edits (NPC, draft, food, water) save as soon as they change, and adding a member keeps edits still in
  progress; adding an actor no longer resets every member back to NPC.

## [0.1.2] - 2026-10-25

### Added
- Drag actors from the sidebar onto the Caravan window or the active caravan's sheet to add them to the roster.

## [0.1.1] - 2026-10-25

### Fixed
- The Caravan window's roster could only add other caravans; it now lists every non-caravan actor (PCs, NPCs,
  animals).

## [0.1.0] - 2026-10-25

### Added
- Hex map authoring on a scene's hex grid with no background image needed: a GM painter for terrain, difficulty,
  regions (encounter table, DC modifiers, water multiplier, storm threshold), Ultimate Campaign and custom tags,
  landmarks, named routes with bargains, effects and GM prompts, plotted off-route paths and party knowledge.
- A hex layer drawn by the module: GMs see the whole map, players only what the party knows.
- The Caravan actor type (`pf1-hexploration.caravan`) with its own sheet: drop items and containers to load the
  hold (ADR-0005).
- The Caravan window: roster with food and water by size (constructs and undead eat nothing), draft animals, the
  hold's Rations and Water from flagged supply items or flagged crates, wagon condition, pack import and export.
- The Travel window with a mini-map: start a leg from a route or plotted path, claim caravan roles, roll pf1 skills
  from each character, resolve the muster, then step the leg day by day (drain, forced-march saves, Fatigued and
  Exhausted, encounter checks against the region's table, token movement, world time), arrive, and undo.
- The seven KtP caravan roles as data-driven defaults, with the Forager DC scaling by mouths and a doubling penalty
  on both rolls.
- GM-only writes through a request channel, and an undo ledger for every automated change (ADR-0002, ADR-0003).
- CI and a tag-triggered GitHub release that Foundry and The Forge install from the manifest URL.

<!--
Each sprint adds its section here, on its own branch, before it merges (newest first):

## [<version>] - YYYY-MM-DD

### Added
- <one plain line per change, written for the user; ADR numbers in parentheses>

Only the subsections that apply, in this order: Added, Changed, Deprecated, Removed, Fixed, Security.
What changed, not how the sprint went (no review rounds, test runs or branch names).
-->

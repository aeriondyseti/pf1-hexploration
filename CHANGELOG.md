# Changelog

All notable changes to PF1 Hexploration are recorded in this file.
The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/); versions follow `0.<milestone>.<feature>` (sprint 1.2 → 0.1.2).

## [Unreleased]

## [0.2.5] - 2026-10-29

The MVP rework (ADR-0008): the module is cut back to its core and its numbers come from published PF1 rules.

### Added
- The Caravan links travellers and pf1 vehicle actors. Each vehicle has a Driver, a Pulled-by team (Ultimate
  Equipment team sizes), seats and a cargo capacity; travellers ride a seat or walk.
- Party funds on the Caravan: players deposit coins from their own characters and withdraw them; NPC wages
  (CRB: 3 sp trained, 1 sp untrained) are paid from it every day.
- Sticky roles set on the Caravan sheet: Navigator, Scout, Forager, Wainwright, Cartographer, Healer/Cook, and a
  Driver per vehicle. Two roles at most, −4 on both.
- Every role is rolled automatically each day, with no dialog, at DCs drawn from the CRB, Ultimate Campaign and
  Ultimate Combat; one summary card per day shows each roll against its DC.
- Activities: Travel, Explore (Ultimate Campaign exploration time; reveals the hex's secrets), Forage and Rest
  (the Wainwright repairs using 10 gp of Repair Materials carried in a vehicle; the Healer gives long-term care).
- Players plot a course on the canvas (click a destination, shift-click waypoints) or follow a known road; the GM
  approves the plan, then steps with Next Day or Travel all.
- Roads: CRB road speeds, no Navigator or Driver check and no vehicle wear.
- Vehicle wear on the pf1 vehicle's HP by terrain (d4/d6/d8, Difficult one size up, a failed Driver one more die);
  broken vehicles move at half pace; overloaded ones at heavy-load pace, and not at all over twice capacity.
- Terrain types from CRB Table 7-8 (plus rocky desert, settlement and water) with their road and trackless speeds.
- Regions carry rations and water multipliers and a DC modifier; routes are highways or roads.

### Changed
- Movement is in whole hexes, at least one a day, from the slowest vehicle or walker's pace.
- Undo restores the last day step only.
- 0.1.x maps are migrated on load (old terrain labels mapped to the new list).

### Removed
- The claim-and-roll muster, rolling once per leg, forced march, conditions at zero supplies, route bargains
  (effects and GM prompts), difficulty grades, custom tags, per-hex encounter mods, storm thresholds, the caravan's
  own hold, Wagon Condition and the draft count, pack import/export, the Travel mini-map and the multi-step ledger.

## [0.1.14] - 2026-10-25

### Fixed
- The hex hover tooltip no longer shows through character sheets or other windows: it appears only while the canvas
  itself is under the cursor.

## [0.1.13] - 2026-10-25

### Added
- Landmarks have an optional Font Awesome icon (e.g. `fa-tower-observation`, `fa-water`), with a live preview in the
  Hex Painter; landmarks without one use `fa-location-dot`.
- Tag symbols come from one table of Font Awesome icons, which the GM can override per tag (custom tags included)
  in the Hex Painter's Tags panel.

### Changed
- Map symbols are Font Awesome glyphs drawn in a single colour: the hex's region border colour, or dark brown outside
  any region. Hidden landmarks (GM view) are drawn faint. The mini-map uses the same icons and colours.
- The hover tooltip names landmarks as "Landmark: …" instead of using a star character.

## [0.1.12] - 2026-10-25

### Added
- Colours accept an alpha channel (`#rrggbbaa` or `#rgba`) everywhere they are drawn. The Hex Painter's region
  colour, map border colour and the new per-route line colour each have an opacity slider beside the picker.
- Routes can have their own line colour (default brown); hidden routes stay faint on top of it.

### Fixed
- An 8-digit colour such as `#7b5ea780` no longer falls back to grey.

## [0.1.11] - 2026-10-25

### Added
- A Hex View panel (eye button in the token controls, hex scenes only) with per-user switches for terrain fill,
  borders, difficulty letters, tag glyphs, routes, route names, landmarks, landmark names, the current leg's path and
  hover tooltips, plus hidden routes for the GM. Each user's choices are saved in their browser. Also available as
  `hx.canvas.getView()` / `setView(patch)` / `openViewPanel()`.

## [0.1.10] - 2026-10-25

### Added
- `hx.caravan`, a caravan service for agents and macros: `place` / `unplace` the caravan token (its position follows
  the token), `add` / `remove` / `update` roster members, `setDraftRequired`, and `get` / `member` / `findMember`.
  Every write returns `{ ok, caravan, ledgerId }` or `{ ok: false, code, error }` and records one undo entry
  (ADR-0007).

### Changed
- The Caravan window, Place on map and dragging the caravan onto the scene all go through `hx.caravan`, so a refused
  change (a duplicate, removing a role-holder mid-leg, moving the caravan during a leg) gives the same reason everywhere.
- Undo can now remove a token the caravan placed, and restore one it removed.

## [0.1.9] - 2026-10-25

### Added
- Regions can carry defaults for new hexes (terrain, difficulty, tags, encounter mod), stamped onto any hex painted
  into the region; the GM can still repaint or retag it afterwards (ADR-0006).
- Each map has defaults for new hexes outside any region and its own travel rules for them: DC modifiers, encounter
  table, water multiplier and storm threshold. "Re-stamp region-less hexes" resets every hex outside a region to
  the map defaults on request.
- A per-hex encounter mod, set with the terrain brush and shown in the hover tooltip.

### Changed
- Route names are optional; an unnamed route draws no label on the map and is listed as e.g. "3-day easy route".
- Hidden routes are drawn faint on the GM's map (players never see them).

## [0.1.8] - 2026-10-25

### Changed
- Hex borders are drawn edge by edge: hexes outside any region use the map's border colour (grey by default, set
  in the Hex Painter), a region's colour wins on every side of its hexes, and where two regions meet each draws its
  colour just inside the shared edge as a double line.

### Removed
- The GM's dashed outline on hexes the party has not explored (the hover tooltip shows what the party knows).

## [0.1.7] - 2026-10-25

### Added
- Hovering over a hex on a hex scene shows a small panel with its terrain and difficulty, region, tags, landmarks,
  routes and whether the caravan is there. GMs also see region tuning and what the party knows; players see only
  what the party knows. Per-user setting: Hex tooltips (on by default).

## [0.1.6] - 2026-10-25

### Changed
- On scenes without a hexagonal grid (battlemaps, backgrounds) the Hex Painter, Caravan Travel and Caravan buttons
  are hidden from the token controls, and the "this scene needs a hexagonal grid" notice no longer appears.

## [0.1.5] - 2026-10-25

### Fixed
- Dragging the Caravan actor onto the scene places its linked token (centred on the hex under the drop) instead of
  doing nothing; the drop is logged to the console for diagnosis.

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

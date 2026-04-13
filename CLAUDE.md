# Letter Mine

An incremental word game where you type to mine letters, collect them with physics, and build words.

## Quick Start

```bash
bun install
bun run dev          # Vite dev server at localhost:3000
bun run build:glyphs # Rebuild glyph physics data → public/glyphs.json
bun run build:dict   # Rebuild dictionary data → public/dictionary.json
```

## Tech Stack

- **Runtime**: Bun (not Node). Use `bun install`, `bun run`, `bunx`.
- **Frontend**: Vite dev server (`bunx vite`). NOT Bun.serve() — Vite handles WASM correctly.
- **Rendering**: HTML5 Canvas 2D with OffscreenCanvas caching per glyph
- **Physics**: Rapier 2D via `@dimforge/rapier2d-compat` (the `-compat` version with async WASM init)
- **Line breaking**: `@chenglou/pretext` for responsive text layout in mining prompt
- **Font parsing**: opentype.js (build-time only)
- **Triangulation**: earcut (build-time only)
- **Decomposition**: poly-decomp-es (build-time convex decomposition)
- **Font**: Playfair Display (bold, variable weight TTF in `public/fonts/`)

## Architecture

### Runtime (browser)

```
index.html → src/main.ts (entry point, WASM init, game boot)
  ├── src/game.ts       — Game class, fixed-timestep loop, spawn queue, basin overflow
  ├── src/physics.ts    — createLetterBody(), Rapier collider creation from glyph data
  ├── src/mining.ts     — MiningPrompt, typing interaction, pretext line breaking
  ├── src/drag.ts       — DragController, spring-based drag, shelf interaction
  ├── src/shelf.ts      — Shelf, word assembly, dictionary validation, submit/dump
  ├── src/render.ts     — LetterRenderer, OffscreenCanvas glyph cache, collider debug
  ├── src/debug.ts      — Debug toggle UI (glyphs, colliders, spawn test)
  ├── src/constants.ts  — All tuning values: scale, physics, colors, layout
  ├── src/types.ts      — Shared interfaces: GlyphData, LetterBody, ShelfLetter, WordStatus
  └── src/style.css     — Minimal reset, parchment background
```

### Build-time (scripts/)

```
scripts/build-glyphs.ts      — Font → bezier sampling → earcut → convex decomposition → glyphs.json
scripts/build-glyphs-hulls.ts — Simplified hull variant (fewer colliders per letter)
scripts/build-dictionary.ts  — SCOWL + SUBTLEX + CMU + WordNet → dictionary.json
scripts/analyze-overlap.ts   — Dataset coverage analysis
```

### Data (data/)

Raw source data, not shipped to the browser:
- `scowl-70.txt` — 142,939 word validation list (SCOWL size 70)
- `en_US-custom.dic` + `.aff` — Hunspell dictionary with affix rules (word families)
- `subtlex-us.tsv` — Word frequency data (SUBTLCD contextual diversity)
- `cmudict.txt` — CMU pronouncing dictionary (phonetics, syllables, rhyme groups)
- `wordnet/dict/` — WordNet 3.0 (parts of speech, synsets)

### Public (served to browser)

- `glyphs.json` — Convex polygon data per character for Rapier colliders
- `dictionary.json` — 142,939 words with freq, tier, root, pos, syl, rhyme
- `fonts/` — Playfair Display TTF

## Key Algorithms

### Physics Loop
Fixed timestep (60 FPS) with accumulator pattern, max 3 substeps. Spring-based drag applies forces before each `world.step()`. Spawn queue deferred to start of frame to avoid mutating world mid-step.

### Glyph Collider Pipeline
opentype.js paths → bezier sampling → earcut triangulation → poly-decomp-es convex decomposition → compound Rapier collider per character. Pre-computed at build time, shipped as `glyphs.json`.

### Rendering
OffscreenCanvas cache keyed by `char_scale`. Each glyph rendered once to an offscreen buffer, then `drawImage`'d per frame. Foreground layering: recently-spawned letters render above shelf for 4s (`FOREGROUND_MS`).

### Rendering Alignment
Physics body center = glyph bounding box center. `fillText` offsets by `-(offsetX + width/2) * scale, -(offsetY + height/2) * scale`. Uses `textBaseline: "alphabetic"`, `textAlign: "left"`.

### Mining Line Breaking
`@chenglou/pretext` `prepareWithSegments` + `layoutWithLines` for responsive text wrapping. Lines generated in batches of 40 words, appended as cursor approaches end.

### Dictionary Validation
Full 143k-word `Set` loaded at startup. Prefix set built by iterating all words and adding all substrings `word[0..i]`. Shelf validates on every letter add/remove/move.

### Basin Overflow
When `letters.length > maxLetters`, 5-second countdown starts. At zero, floor rigid body is removed — letters fall through kill plane (`height + 300px`). Floor restored when basin empties.

## Scale & Constants

All tuning values live in `src/constants.ts`. Key numbers:

- `SCALE = 100` — 100 pixels = 1 physics meter
- Lowercase: `renderScale = 0.6` (60px font, ~0.3m body)
- Uppercase: `renderScale = 1.0` (100px font, ~0.5m body)
- `GLYPH_TO_PHYSICS = 1/100` converts glyph units to meters
- Basin max: 500 letters, warn at 80%, drain countdown 5s
- Shelf: 40% screen height, 12 max slots, 48px slot width
- Physics: gravity 20, 8 solver iterations, 2 PGS iterations

## Dictionary Data

143k words from SCOWL size 70. Each entry: `{ freq, tier, root, pos, syl, rhyme }`.

Tiers (from SUBTLEX-US contextual diversity):
- 0 (legendary): freq = 0, never in film subtitles — 55.1%
- 1 (rare): <1% of films — 37.5%
- 2 (uncommon): 1-10% — 5.9%
- 3 (common): 10-50% — 1.1%
- 4 (universal): 50%+ — 0.3%

Word families via Hunspell affix expansion: `root` field maps inflected forms to base (cats→cat, running→run).

## Visual Style

- **Aesthetic**: Hyper-traditional letterpress / typesetter's workshop
- **Font**: Playfair Display for everything
- **Palette**: parchment `#F5F0E8`, walnut ink `#2C2416`, dark ink `#1A1008`, worn wood `#8B7355`, burnt sienna `#6B4423`, faded `#C4B69C`, muted `#9E8E76`
- **Letters ARE the physics bodies** — glyph outlines define collision shapes, not tiles/blocks

## Gotchas

- `@dimforge/rapier2d` (non-compat) does NOT work with Vite — WASM import fails silently. Must use `@dimforge/rapier2d-compat` with explicit `init()` call.
- Type-only exports must use `import { type Foo }` syntax or Vite crashes.
- The game listens for `keydown` on `window` — don't let input elements steal focus.
- Rapier's `ColliderDesc.convexHull()` can return valid descriptors for degenerate shapes but `world.createCollider()` throws — wrap in try/catch.

## Current State

V1 mechanics complete: mining, physics, drag, shelf, word validation, basin overflow. No scoring or progression yet. See `GAMEPLAY.md` for the gameplay design (economy, upgrades, progression).

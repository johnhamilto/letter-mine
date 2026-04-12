# Letter Mine

An incremental word game where you type to mine letters, collect them with physics, and build a dictionary for profit.

## Core Fantasy

You're a letter miner. Words appear on screen monkeytype-style. As you type each character correctly, the letter "breaks off" and tumbles down into a collection basin with realistic physics (Rapier 2D). You accumulate a hoard of loose letters, then combine them into real English words to fill out your personal dictionary and sell them.

## V1 Scope

The first playable version. No economy, no upgrades, no progression. Just the core
feel: type, collect, assemble, validate.

```
Type words → letters break off and fall → click/drag letters to shelf → form words → validate
```

### Screen Layout

The entire screen is one physics scene. The shelf is a physical object sitting
inside the basin, not a separate UI zone. Letters fall past the shelf, pile up
below and around it.

```
┌──────────────────────────────────────────────┐
│                                              │
│   the quick brown fox jumps over             │  ← Mining prompt (HUD overlay)
│       ^                                      │    Not a physics object
│                                              │
│          t                                   │
│     e        h                               │  ← Letters falling (physics bodies)
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │ [ c ] [ a ] [ t ] [   ] [   ] [   ]     │ │  ← Shelf (static physics body)
│  │                        ✓ cat            │ │    Sits at ~40% height
│  └─────────────────────────────────────────┘ │
│                                              │
│     r    n  o  i    p    a                   │
│   d  l  c  m  u  h  b  g  s  e  t          │  ← Letters piled below shelf
│  ════════════════════════════════════════════│  ← Basin floor
└──────────────────────────────────────────────┘
```

### Mining

- Random common words (universal/common tier from our dictionary) appear as a typing prompt
- Prompt is a HUD overlay at the top — not part of the physics world
- Words separated by spaces, continuous stream like monkeytype
- Each correct keystroke "breaks off" the letter — it spawns as a Rapier 2D body
  at the prompt position and falls into the basin
- Letters tumble past/off the shelf on the way down, landing in the pile below
- Mistyped keys: skip the letter (it stays in the prompt, unbroken) — keep it simple for v1

**Uppercase letters:**
- Every 8 words (or first word of each "line"), the first letter is capitalized
- Uppercase letters are visually larger with distinct physics silhouettes
- Using an uppercase letter as the first letter of an assembled word = 2x score multiplier
- Uppercase letters are a strategic resource — spend on a short word or save for a big one
- They retain their case on the shelf: placing capital **C** + **a** + **t** shows "Cat"

### Basin

- The entire game container (viewport-sized) is the basin
- Walls on left, right, floor on bottom — open at the top where letters spawn
- The shelf is a static Rapier body sitting at roughly 40% height
  - Letters collide with it on the way down, tumble off the sides
  - Some may land on top of the shelf naturally — fun emergent moment
- Player interacts with letters in two ways:
  - **Click** a letter in the basin: moves it to the next open slot on the shelf
  - **Drag** a letter: pick it up (physics body follows cursor), drop on shelf or back in basin

### Shelf

- A physical platform inside the basin with fixed letter slots on top
- Letters placed here snap upright, aligned, readable left-to-right
- Dragging on the shelf reorders letters (insert between existing)
- As letters are placed, game checks the current sequence:
  - Valid word: visual feedback (glow, color change), "submit" becomes available
  - Valid prefix: subtle hint — could become a word with more letters
  - Neither: no feedback, just letters sitting there
- Submitting a valid word: letters are consumed, word is logged in a simple list
- Clearing: button or gesture to dump shelf letters back into the basin (they fall off the shelf as physics bodies)

### Word Validation

- Uses our built dictionary.json (142k words)
- For v1, just a Set lookup — is this exact string a valid word?
- Display: word, its tier (legendary/rare/uncommon/common/universal), and family root
- Track discovered words in a simple list (no catalog UI yet)

### What V1 Does NOT Include

- Economy / currency / selling
- Upgrades or progression
- Semantic Rush
- Dictionary catalog UI
- Idle / auto-mining
- Sound effects or music
- Persistent save state

## V2+ Ideas (Parked)

### Economy & Selling

- Words have value based on length, rarity of letters, and complexity
- Sell words for currency to buy upgrades
- Currency ideas: "Ink," "Pages," "Royalties"

### Word Families

- First word discovered in a family = full value
- Subsequent family members = reduced value
- Completing a family = bonus

### Semantic Rush

See dedicated section below.

### Upgrades / Progression

- Mining speed, letter quality, basin capacity
- Auto-miner for idle play
- Word radar, letter magnets
- Prestige: "publish your dictionary"

## Dictionary System

### V1: Simple Set Lookup

Ship `dictionary.json` (12 MB, 143k words). Load into a `Map<string, WordEntry>` at startup.
Each entry has: `freq`, `tier`, `root`, `pos`, `syl`, `rhyme`.

Validation = `map.has(word)`. Metadata = `map.get(word)`.

For v1 this is fine. If load time or memory becomes an issue, move to a DAWG (~2 MB)
for validation with a separate lazy-loaded metadata file.

### Prefix Checking (V1 stretch goal)

Build a `Set` of all valid prefixes at startup (for every word "cat", add "c" and "ca").
This enables "this could become a word" hints on the shelf as the player places letters.
Cheap to build, ~500k entries, fast lookup.

## Semantic Rush (Timed Challenge Mechanic)

A recurring event that interrupts the idle loop with a skill-based semantic challenge.

### How It Works

1. A **theme bell** rings — a category/concept flashes on screen (e.g., "WEATHER", "SHARP THINGS", "EMOTIONS")
2. A **clock** starts (30–60 seconds, upgradeable)
3. Player assembles words from their basin letters as fast as possible
4. Each submitted word is scored by **semantic similarity** to the theme (0.0–1.0)
5. Clock expires, total score converts to bonus currency / rewards

### Scoring

Words aren't binary right/wrong — they score on a gradient:

```
Theme: "OCEAN"

  wave    → 0.92  (direct)
  tide    → 0.88  (direct)
  salt    → 0.74  (strong association)
  blue    → 0.61  (moderate)
  fish    → 0.58  (related but broader)
  breeze  → 0.41  (loose connection)
  chair   → 0.08  (basically unrelated)
```

This rewards creative lateral thinking. "Brine" scoring 0.85 when you didn't think of it
is a moment of delight. Obscure-but-relevant words feel like discoveries.

### Similarity Threshold

- Below ~0.25: rejected, "not related enough" — letters returned to basin
- 0.25–0.50: accepted but low payout, "tangential"
- 0.50–0.75: solid payout, "related"
- 0.75+: high payout, "direct hit"

### Implementation

Pre-compute at build time, not at runtime:

1. Embed all dictionary words + a curated list of ~200 themes using a sentence-transformer
2. For each theme, pre-compute similarity scores against all dictionary words
3. Ship as a compressed lookup: `theme → { word: score }` (only words above 0.25 threshold)
4. ~200 themes x ~5k qualifying words each = ~1M entries, very compressible

This avoids any ML inference client-side. The game just does map lookups.

### Cadence & Progression

- Early game: rushes are rare, simple themes ("FOOD", "ANIMALS"), long timer
- Mid game: more frequent, abstract themes ("FREEDOM", "DANGER"), moderate timer
- Late game: very abstract or compound themes ("THINGS THAT MELT", "CHILDHOOD"), short timer
- Upgrades: longer clock, theme preview (see it before it starts), score multipliers
- Could have "legendary rushes" — rare high-value themes with unique rewards

### Why This Works

- **Basin pressure valve**: gives you a reason to spend letters instead of hoarding
- **Skill expression**: vocabulary breadth + lateral thinking, not just typing speed
- **Emergent moments**: surprising words scoring well creates stories ("wait, 'glass' counts for OCEAN?")
- **Complementary loop**: mining is mechanical/meditative, rushes are frantic/cognitive — good rhythm

## Dictionary Catalog UI

- Visual bookshelf / dictionary that fills in as you discover words
- Could be organized alphabetically, by word family, by rarity tier
- Completion percentage gives long-term goals
- "Collections" — discover all words in a theme (animals, colors, etc.) for bonuses

## Dictionary Pipeline (Build-Time)

Implemented in `scripts/build-dictionary.ts`. Merges five sources into `dist/dictionary.json`.

### Sources

| Source | File | What it provides |
|--------|------|-----------------|
| SCOWL size 70 | `data/scowl-70.txt` | 142,939 valid English words (validation set) |
| Hunspell | `data/en_US-custom.dic` + `.aff` | 74,522 base words + affix rules → word families |
| SUBTLEX-US | `data/subtlex-us.tsv` | Frequency (SUBTLCD — % of films containing word) |
| CMU Dict | `data/cmudict.txt` | Phonetic transcriptions → syllable count, rhyme groups |
| WordNet 3.0 | `data/wordnet/dict/` | Parts of speech |

### Output

`dist/dictionary.json` — 12.1 MB, 142,939 entries.

```jsonc
{
  "cat": { "freq": 16.52, "tier": 3, "root": "cat", "pos": ["n","v"], "syl": 1, "rhyme": "AE-T" },
  "cats": { "freq": 6.43, "tier": 2, "root": "cat", "pos": ["n","v"], "syl": 1, "rhyme": "AE-T-S" }
}
```

### Coverage

| Field | Coverage | Gap handling |
|-------|----------|-------------|
| freq | 44.9% | Missing = 0 (genuinely never spoken in film) |
| tier | 100% | Derived from freq |
| root | 48.6% have root != self | Rest = self (is its own root) |
| pos | 70.3% | Missing = [] |
| syl | 54.0% | Missing = 0 |
| rhyme | 54.0% | Missing = null |

### Tier Distribution

| Tier | Name | Count | % | Freq threshold |
|------|------|-------|---|---------------|
| 0 | legendary | 78,819 | 55.1% | 0 (not in SUBTLEX) |
| 1 | rare | 53,555 | 37.5% | <1% of films |
| 2 | uncommon | 8,456 | 5.9% | 1–10% of films |
| 3 | common | 1,625 | 1.1% | 10–50% of films |
| 4 | universal | 484 | 0.3% | 50%+ of films |

## Visual Style

**Aesthetic: Hyper-traditional letterpress / typesetter's workshop**

### Font

**Playfair Display** (Google Fonts, free) for everything — both the mining prompt and
the letter physics bodies. High-contrast serif with dramatic thick/thin strokes.
Individual characters have strong, distinctive silhouettes — important because the
glyphs ARE the physics shapes.

### Letter Physics Shapes

Letters are NOT tiles/blocks with text on them. The actual glyph outline IS the
collision body. An "A" is a triangle with legs. An "O" rolls. An "M" is a wide
stable base. Each letter has its own physics personality.

**Implementation:**
```
Font file (.woff2)
  → parse glyph outlines (opentype.js)
  → sample bezier curves into polygons
  → Rapier convexDecomposition()
  → compound collider per character
```

Pre-compute at build time for all 52 characters (26 upper + 26 lower).
Cache polygon data as JSON, load at startup.

Uppercase letters are physically larger — more mass, more presence in the basin.
A big serif **R** sitting in the pile is unmistakable.

### Color Palette

```
Background:       #F5F0E8   warm parchment
Letter fill:      #2C2416   dark walnut (ink)
Uppercase fill:   #1A1008   deeper black (premium ink)
Shelf:            #8B7355   worn wood
Valid word glow:  #6B4423   burnt sienna
Ghost/inactive:   #C4B69C   faded ink
Paper texture:    #EDE6D6   subtle grain
Mining prompt:    #9E8E76   muted — not the focus
Typed letters:    #2C2416   darkens as you type them
```

## Tech Stack

- **Language**: TypeScript + Bun
- **Rendering**: Canvas (HTML5 Canvas 2D or Pixi.js)
- **Physics**: Rapier 2D (WASM) — glyph-shaped collision bodies
- **Font parsing**: opentype.js — extract glyph bezier paths for physics shapes
- **Dictionary**: `dictionary.json` loaded into a Map at startup
- **Framework**: TBD — vanilla, Svelte, or Solid

## Open Questions

- How many letters in the basin before it gets overwhelming? Need a cap or auto-cleanup
- Shelf size — fixed number of slots (7? 10?) or expandable?
- How to handle the space bar during mining? Skip it silently or make spaces a distinct event?
- What does "submit a word" look like? Button? Enter key? Automatic when valid?
- Glyph polygon resolution — how many points per bezier curve? Too few = jagged, too many = slow physics

## Inspiration

- **Monkeytype**: typing feel, keystroke feedback, minimal aesthetic
- **Cookie Clicker / Universal Paperclips**: incremental progression, satisfying numbers
- **Bookworm**: word formation from a grid of letters
- **Noita / Baba Is You**: physics-driven game feel, letters as physical objects

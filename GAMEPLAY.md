# Letter Mine — Gameplay Design

Target: 2-3 hours active play to completion. Idle at ~20% efficiency.

## Core Loop

```
Type words → letters fall into basin → drag letters to shelf → form words → earn Ink → buy upgrades
```

The bottleneck is word assembly, not typing. Finding letters in a pile of physics bodies, dragging them to the shelf, and forming valid words is the slow, deliberate part. Progression should accelerate and deepen assembly.

## Ink (Currency)

Single currency. Every word submitted earns Ink. Every letter mined earns 0.1 Ink (the idle trickle).

### Word Value

```
value = floor(length^1.5) * tierMultiplier * bonuses
```

| Length | Base | Universal (1x) | Common (1.5x) | Uncommon (3x) | Rare (6x) | Legendary (15x) |
|--------|------|-----------------|----------------|----------------|------------|------------------|
| 4      | 8    | 8               | 12             | 24             | 48         | 120              |
| 5      | 11   | 11              | 16             | 33             | 66         | 165              |
| 6      | 15   | 15              | 22             | 45             | 90         | 225              |
| 7      | 18   | 18              | 27             | 54             | 108        | 270              |
| 8      | 23   | 23              | 34             | 69             | 138        | 345              |
| 10     | 32   | 32              | 48             | 96             | 192        | 480              |
| 12     | 42   | 42              | 63             | 126            | 252        | 630              |

### Bonuses (multiplicative, stack)

- **First in family**: 2x — discovering "cat" as a root. "cats", "catty" after that are 1x.
- **Uppercase opener**: 1.5x — using a capital letter as the first letter of the word.
- **Streak**: +10% per consecutive valid submit, caps at +50%.
- **Repeat word**: 10% value — prevents grinding the same easy word.

Discovered words tracked as a set. Sidebar shows total discoveries + Ink.

## Upgrades

6 tracks, unlocked progressively via milestones. Costs exponential within each track.

### Basin Capacity (5 levels)
500 → 650 → 850 → 1100 → 1500

More letters to pick from, less overflow panic. Available from Apprentice.

Cost: 50 / 200 / 500 / 1500 / 5000

### Shelf Width (4 levels)
12 → 15 → 18 → 22 slots

Longer words = exponentially more valuable (length^1.5 scaling). Available from Apprentice.

Cost: 100 / 400 / 1200 / 4000

### Mining Quality (4 levels)
Controls which tier of words appear in the mining prompt.

- Level 0 (base): universal + common words only
- Level 1: + uncommon words mixed in
- Level 2: + rare words mixed in
- Level 3: + legendary words (low weight)

Rarer prompt words → unusual letter combinations → access to high-tier dictionary words. Available from Journeyman.

Cost: 150 / 600 / 2000 / 8000

### Auto-Miner (5 levels)
Types automatically when you're not typing.

- Level 1: 0.5 chars/sec (~6 WPM)
- Level 2: 1 char/sec (~12 WPM)
- Level 3: 2 chars/sec (~24 WPM)
- Level 4: 3 chars/sec (~36 WPM)
- Level 5: 5 chars/sec (~60 WPM)

Just mines letters — doesn't assemble words. The idle mechanic. Available from Wordsmith.

Cost: 300 / 800 / 2500 / 7000 / 20000

### Letter Magnet (3 levels)
Click pickup radius for grabbing letters from the basin.

- Level 1: 1.5x radius
- Level 2: 2x radius
- Level 3: 3x radius

QoL — makes assembly faster in a crowded basin. Available from Journeyman.

Cost: 200 / 800 / 3000

### Ink Multiplier (5 levels)
Flat multiplier on all Ink earned from words.

+10% / +25% / +50% / +75% / +100%

Late-game scaling. Available from Lexicographer.

Cost: 500 / 1500 / 5000 / 15000 / 50000

## Milestones

Gates that unlock upgrade tracks and mark progression chapters.

| Milestone | Total Ink | Unlocks |
|-----------|-----------|---------|
| Apprentice | 50 | Upgrade shop, Basin Capacity, Shelf Width |
| Journeyman | 500 | Mining Quality, Letter Magnet |
| Wordsmith | 2000 | Auto-Miner |
| Lexicographer | 8000 | Ink Multiplier |
| Publisher | 30000 | Win — "Publish Your Dictionary" ending |

## Pacing

Target Ink rates by phase (active play):

| Phase | Time | Ink/min | Cumulative | Milestone hit |
|-------|------|---------|------------|---------------|
| Early | 0-20 min | ~20 | ~400 | Apprentice, Journeyman |
| Mid | 20-60 min | ~50 | ~2400 | Wordsmith |
| Late | 60-120 min | ~100 | ~8400 | Lexicographer |
| Endgame | 120-150 min | ~150 | ~12900 | Publisher |

These are rough — actual tuning happens during playtesting. The curves should feel like each upgrade noticeably accelerates your earning rate.

## Idle Loop

Auto-miner types and letters accumulate in basin. Per-letter Ink trickle (0.1/letter) generates passive income.

At max auto-miner (5 chars/sec = 300 chars/min): ~30 Ink/min idle.
Active play mid-to-late game: ~100-150 Ink/min.
Ratio: ~20-30% efficiency.

When you return from idle: basin is full of letters ready to assemble. The auto-miner doesn't assemble — that's always manual. Idle generates raw materials, not finished value.

## Mining Prompt Tiers

Currently the mining prompt draws from a fixed word bank (MINING_WORDS). With Mining Quality upgrades, it should draw from the dictionary by tier:

- Base: tier 3-4 (common/universal) — simple words, common letters
- Level 1: tier 2-4 — uncommon words start appearing (~10% of prompt)
- Level 2: tier 1-4 — rare words mixed in (~15% of prompt)
- Level 3: tier 0-4 — legendary words at low weight (~5% of prompt)

Higher-tier prompt words contain unusual letter combinations (q, x, z, double letters) needed to form rare dictionary words on the shelf.

## Future (not in scope for initial implementation)

- **Semantic Rush**: timed challenges where you form words related to a theme, scored by pre-computed semantic similarity
- **Dictionary Catalog**: visual bookshelf UI showing discovered words organized by family/tier
- **Prestige**: "publish" resets upgrades but keeps discoveries, earns permanent multiplier
- **Sound**: typing clicks, letter thuds, word chimes, drain woosh

# Letter Mine — Gameplay Design

> **Purpose of this file:** Game design: economy, scoring, upgrades, milestones, pacing, idle loop. The authoritative source for all gameplay numbers. Not architecture (see CLAUDE.md) or feedback (see FEEDBACK.md).

Target: 2-3 hours active play to completion. Idle at ~20% efficiency.

## Core Loop

```text
Type words → letters fall into basin → drag letters to shelf → form words → earn Ink → buy upgrades
```

The bottleneck is word assembly, not typing. Finding letters in a pile of physics bodies, dragging them to the shelf, and forming valid words is the slow, deliberate part. Progression should accelerate and deepen assembly.

## Ink (Currency)

Single currency. Every word submitted earns Ink. Every letter mined earns 0.1 Ink (the idle trickle).

### Word Value

```typescript
value = Math.floor(Math.pow(length, 1.5)) * tierMultiplier * bonuses
```

| Length | Base | Universal (1x) | Common (1.5x) | Uncommon (3x) | Rare (6x) | Legendary (15x) |
|--------|------|----------------|---------------|---------------|-----------|-----------------|
| 4      | 8    | 8              | 12            | 24            | 48        | 120             |
| 5      | 11   | 11             | 16            | 33            | 66        | 165             |
| 6      | 15   | 15             | 22            | 45            | 90        | 225             |
| 7      | 18   | 18             | 27            | 54            | 108       | 270             |
| 8      | 23   | 23             | 34            | 69            | 138       | 345             |
| 10     | 32   | 32             | 48            | 96            | 192       | 480             |
| 12     | 42   | 42             | 63            | 126           | 252       | 630             |

### Bonuses (multiplicative, stack)

- **First in family**: 2x — discovering "cat" as a root. "cats", "catty" after that are 1x.
- **Uppercase opener**: 1.5x — using a capital letter as the first letter of the word.
- **Streak**: +10% per consecutive valid submit, caps at +50%.
- **Repeat word**: 10% value — prevents grinding the same easy word.

Discovered words tracked as a set. Sidebar shows total discoveries + Ink.

### Discovered Word Feedback

When the current shelf word matches a previously discovered word, shelf letters render green. Tells the player "you already know this one — 10% value."

## Upgrades (Tiered)

6 tracks, unlocked progressively via milestones. Costs exponential within each track.

### Basin Capacity (7 levels)

50 → 75 → 100 → 150 → 200 → 300 → 500

Starts very tight — forces you to spend letters early. Each level relieves overflow pressure and gives more raw material to work with. Available from Apprentice.

Cost: 30 / 80 / 200 / 500 / 1500 / 4000 / 10000

### Shelf Width (11 levels)

4 → 5 → 6 → 7 → 8 → 9 → 11 → 15 → 22 → 45

Early levels are +1 slot each — every upgrade immediately unlocks a new word length. Then the gaps widen as diminishing returns kick in (most words are under 15 letters). Final level is a vanity/achievement unlock for the longest dictionary word (pneumonoultramicroscopicsilicovolcanoconiosis, 45 letters). Available from Apprentice.

Cost: 20 / 40 / 80 / 150 / 300 / 600 / 1500 / 4000 / 15000 / 50000

### Mining Quality (4 levels)

Controls which tier of words appear in the mining prompt.

- Level 0 (base): universal + common words only
- Level 1: + uncommon words mixed in
- Level 2: + rare words mixed in
- Level 3: + legendary words (low weight)

Rarer prompt words produce unusual letter combinations needed for high-tier dictionary words. Available from Journeyman.

Cost: 150 / 600 / 2000 / 8000

### Auto-Miner (5 levels)

Types automatically when you're not typing.

- Level 1: 0.5 chars/sec (~6 WPM)
- Level 2: 1 char/sec (~12 WPM)
- Level 3: 2 chars/sec (~24 WPM)
- Level 4: 3 chars/sec (~36 WPM)
- Level 5: 5 chars/sec (~60 WPM)

Just mines letters — doesn't assemble words. The idle mining mechanic. Available from Wordsmith.

Cost: 300 / 800 / 2500 / 7000 / 20000

### Apprentice Shelf Width (10 levels)

4 → 5 → 6 → 7 → 8 → 9 → 11 → 15 → 22 → 45

Same progression as the main shelf. Each level lets the apprentice assemble longer (more valuable) words from your discovered list. Available from Lexicographer (requires Apprentice Shelf unlock).

Cost: 300 / 600 / 1200 / 2500 / 5000 / 10000 / 20000 / 40000 / 80000 / 150000

### Ink Multiplier (5 levels)

Flat multiplier on all Ink earned from words.

+10% / +25% / +50% / +75% / +100%

Late-game scaling. Available from Lexicographer.

Cost: 500 / 1500 / 5000 / 15000 / 50000

## Upgrades (Unique)

One-time unlocks available after specific milestones. Not tiered — each is a distinct new mechanic.

### Siphon (Wordsmith)

Press Tab to toggle focus between the mining prompt and the shelf. The cursor underline moves to show which is active. In shelf mode, typing a letter pulls a matching letter from the basin onto the shelf — bypasses drag entirely. If multiple instances exist, pulls the one nearest the shelf. Only works if the shelf has room. Typing a letter that isn't in the basin does nothing (no penalty).

Tab back to mining mode to keep generating letters. The rhythm becomes: mine a batch, Tab, type the word you want, Tab, mine more.

Cost: 1000

### Vowel Bloom (Journeyman)

Vowels (a, e, i, o, u) in the basin emit a subtle warm glow. Always-on after unlock. Vowels are the assembly bottleneck — finding them in a pile of consonants is the #1 friction point.

Cost: 300

### Word Ghost (Wordsmith)

When the shelf has 3+ letters forming a valid prefix, letters in the basin that could complete a valid word pulse gently. Shows you "there's an R in the pile that would make this a word." Only highlights one completion at a time (shortest valid word).

Cost: 1500

### Word Check (Journeyman)

Shelf displays whether the current letter sequence is a valid dictionary word and blocks submission of invalid words. Before this upgrade, you submit blind — you only find out if it's a word when you hit Enter, and invalid submissions dump your letters back into the basin.

Cost: 400

### Basin Shake (Apprentice)

Press Shift+Space to agitate all basin letters, spreading them out. Helps when letters are piled too deep to see or click. Brief physics impulse — letters scatter, then resettle. 3-second cooldown.

Cost: 100

### Apprentice Shelf (Lexicographer)

A second shelf that automatically assembles words from your discovered word list. Not manually interactable — it runs on its own. Scans basin letters, picks the highest-value discovered word it can form, animates letters flying from basin to shelf, and auto-submits.

Starts at 4 slots (only 4-letter discovered words). Expand with the Apprentice Shelf Width tiered upgrade.

The idle assembly mechanic. Combined with auto-miner (idle mining), gives full idle capability at ~20% active efficiency. Creates a virtuous loop: discover more words → apprentice has more recipes → more passive income.

Cost: 5000

### Word Compass (Lexicographer)

Highlights valid "next" letters in the basin for the word you're currently building on the shelf — but only for words you haven't discovered yet. Guides you toward new discoveries without handing them to you outright.

Three visual states:
- **Available**: a basin letter that would extend your shelf into a valid undiscovered prefix or word gets a colored highlight (distinct from hover glow). Multiple letters may highlight if several next-letters are valid.
- **Exists but not in basin**: a subtle indicator on the shelf (e.g., faded ghost letter at the next slot position) showing that a valid next-letter exists in the dictionary but isn't currently in the basin. Tells you "keep mining, the letter you need will come."
- **Dead end**: no indicator — the current shelf sequence can't become any undiscovered word. You know to submit what you have or rearrange.

Only considers words NOT in your discovered set. Once you've found "cat", the compass won't guide you to "cat" again — it pushes you toward new territory. Works with the prefix set that's already built at startup.

Cost: 8000

### Auto-Discovery (Publisher)

The apprentice shelf gains the ability to discover new words, not just replay known ones. It uses the same prefix validation and dictionary lookup the player does — tries extending random prefixes from available basin letters until it finds a valid undiscovered word, then assembles and submits it.

Discovery rate is slower than a skilled player (it's brute-forcing, not thinking) but it never stops. With a full basin and max apprentice shelf width, it steadily chews through the dictionary. This is the final automation layer — the game plays itself toward 100% completion while you watch or help.

The "Publish Your Dictionary" ending triggers at a completion threshold (e.g., 50% of all 143k words discovered, or a total Ink milestone). The post-Publisher game is watching the percentage climb toward 100%.

Cost: 20000

## Milestones

Gates that unlock upgrade tracks and mark progression chapters.

| Milestone     | Total Ink | Unlocks                                                              |
|---------------|-----------|----------------------------------------------------------------------|
| Apprentice    | 50        | Upgrade shop, Basin Capacity, Shelf Width, Basin Shake               |
| Journeyman    | 500       | Mining Quality, Vowel Bloom, Word Check                              |
| Wordsmith     | 2000      | Auto-Miner, Siphon, Word Ghost                                      |
| Lexicographer | 8000      | Ink Multiplier, Apprentice Shelf, Apprentice Shelf Width, Word Compass |
| Publisher     | 30000     | Auto-Discovery, "Publish Your Dictionary" ending begins              |

## Pacing

Target Ink rates by phase (active play):

| Phase   | Time        | Ink/min | Cumulative | Milestone hit          |
|---------|-------------|---------|------------|------------------------|
| Early   | 0-20 min    | ~20     | ~400       | Apprentice, Journeyman |
| Mid     | 20-60 min   | ~50     | ~2400      | Wordsmith              |
| Late    | 60-120 min  | ~100    | ~8400      | Lexicographer          |
| Endgame | 120-150 min | ~150    | ~12900     | Publisher              |

These are rough — actual tuning happens during playtesting. The tighter starting basin (50 letters) creates early urgency that eases as you upgrade.

## Idle Loop

Auto-miner types and letters accumulate. Apprentice shelf assembles words from discovered list. Per-letter Ink trickle (0.1/letter) adds baseline passive income.

**Idle income sources:**
- Per-letter trickle: ~30 Ink/min at max auto-miner
- Apprentice shelf: ~15-25 Ink/min (depends on discovered words + available letters)
- Total idle: ~45-55 Ink/min

**Active play:** ~100-150 Ink/min mid-to-late game.

**Ratio:** ~30-40% at max upgrades. Without apprentice shelf, ~20%.

**Post-Publisher:** Auto-Discovery lets the apprentice shelf find new words on its own. The endgame becomes a slow, satisfying crawl toward 100% dictionary completion — the game keeps running as long as you want.

## Mining Prompt Tiers

With Mining Quality upgrades, the prompt draws from progressively wider tier ranges:

- Base: tier 3-4 (common/universal) — simple words, common letters
- Level 1: tier 2-4 — uncommon words (~10% of prompt)
- Level 2: tier 1-4 — rare words (~15% of prompt)
- Level 3: tier 0-4 — legendary words (~5% of prompt)

Higher-tier prompt words contain unusual letter combinations (q, x, z, double letters) needed to form rare dictionary words on the shelf.

## Future (not in scope for initial implementation)

- **Semantic Rush**: timed challenges where you form words related to a theme, scored by pre-computed semantic similarity
- **Dictionary Catalog**: visual bookshelf UI showing discovered words organized by family/tier
- **Prestige**: "publish" resets upgrades but keeps discoveries, earns permanent multiplier
- **Sound**: typing clicks, letter thuds, word chimes, drain woosh

/** Economy — scoring, ink tracking, discovered words. */

import { SCORING } from './constants'
import type { GameState } from './state'
import type { DictionaryEntry, ScoreBonus, ScoreResult, ShelfLetter } from './types'

export class Economy {
  ink = 0
  totalInkEarned = 0
  discoveredWords = new Set<string>()
  discoveredRoots = new Set<string>()

  /** Ink multiplier bonus fraction (0 = none, 1.0 = +100%). Set by game from upgrade level. */
  inkMultiplierBonus = 0

  scoreWord(
    word: string,
    letters: ShelfLetter[],
    entry: DictionaryEntry | undefined,
    opts: { forceRepeat?: boolean } = {},
  ): ScoreResult {
    const normalized = word.toLowerCase()
    const length = normalized.length
    const baseValue = Math.floor(Math.pow(length, 1.5) * SCORING.baseScoreMultiplier)

    const tier = entry?.tier ?? 0
    const tierMultiplier = SCORING.tierMultipliers[tier] ?? 1

    const bonuses: ScoreBonus[] = []
    const alreadyDiscovered = this.discoveredWords.has(normalized)
    const isRepeat = opts.forceRepeat || alreadyDiscovered
    const root = entry?.root ?? normalized
    const isFirstInFamily = !isRepeat && !this.discoveredRoots.has(root)
    const isNewDiscovery = !alreadyDiscovered && !opts.forceRepeat

    // First in family bonus
    if (isFirstInFamily) {
      bonuses.push({
        label: 'First in Family',
        multiplier: SCORING.firstInFamilyBonus,
      })
    }

    // Uppercase opener bonus
    if (letters.length > 0 && letters[0]?.isUpper) {
      bonuses.push({
        label: 'Uppercase',
        multiplier: SCORING.uppercaseOpenerBonus,
      })
    }

    // Compute final value
    let finalInk = baseValue * tierMultiplier
    for (const b of bonuses) {
      finalInk *= b.multiplier
    }

    // Repeat word penalty
    if (isRepeat) {
      finalInk *= SCORING.repeatWordPenalty
    }

    // Ink multiplier upgrade
    if (this.inkMultiplierBonus > 0) {
      finalInk *= 1 + this.inkMultiplierBonus
    }

    finalInk = Math.floor(finalInk)

    // Update state (only record a new discovery when it genuinely is one)
    if (!opts.forceRepeat) {
      this.discoveredWords.add(normalized)
      this.discoveredRoots.add(root)
    }
    this.ink += finalInk
    this.totalInkEarned += finalInk

    return {
      word,
      baseValue,
      tierMultiplier,
      bonuses,
      finalInk,
      isRepeat,
      isNewDiscovery,
      isFirstInFamily,
    }
  }

  letterMinedInk: number = SCORING.letterMinedInk

  creditLetterMined(): number {
    this.ink += this.letterMinedInk
    this.totalInkEarned += this.letterMinedInk
    return this.ink
  }

  isDiscovered(word: string): boolean {
    return this.discoveredWords.has(word.toLowerCase())
  }

  /**
   * Silently adds words to the discovered set without crediting ink. Used by
   * Imprimatur to reveal family members of a submitted word's root — the root
   * already paid the first-in-family bonus, so this is pure set-membership growth.
   * Returns the list of words that were actually newly discovered.
   */
  discoverFamily(words: Iterable<string>): string[] {
    const added: string[] = []
    for (const w of words) {
      const lc = w.toLowerCase()
      if (!this.discoveredWords.has(lc)) {
        this.discoveredWords.add(lc)
        added.push(lc)
      }
    }
    return added
  }

  spendInk(amount: number): boolean {
    if (this.ink < amount) return false
    this.ink -= amount
    return true
  }

  /** Snapshot economy fields into a partial state. Caller merges with upgrade/milestone data. */
  toPartialState(): Pick<
    GameState,
    'ink' | 'totalInkEarned' | 'discoveredWords' | 'discoveredRoots'
  > {
    return {
      ink: this.ink,
      totalInkEarned: this.totalInkEarned,
      discoveredWords: [...this.discoveredWords],
      discoveredRoots: [...this.discoveredRoots],
    }
  }

  fromState(state: GameState) {
    this.ink = state.ink
    this.totalInkEarned = state.totalInkEarned
    this.discoveredWords = new Set(state.discoveredWords)
    this.discoveredRoots = new Set(state.discoveredRoots)
  }
}

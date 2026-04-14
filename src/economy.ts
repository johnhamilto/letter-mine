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

  /** Last score result for HUD flash. */
  lastScore: ScoreResult | null = null
  lastScoreTime = 0

  scoreWord(word: string, letters: ShelfLetter[], entry: DictionaryEntry | undefined): ScoreResult {
    const normalized = word.toLowerCase()
    const length = normalized.length
    const baseValue = Math.floor(Math.pow(length, 1.5) * SCORING.baseScoreMultiplier)

    const tier = entry?.tier ?? 0
    const tierMultiplier = SCORING.tierMultipliers[tier] ?? 1

    const bonuses: ScoreBonus[] = []
    const isRepeat = this.discoveredWords.has(normalized)
    const root = entry?.root ?? normalized
    const isFirstInFamily = !this.discoveredRoots.has(root)
    const isNewDiscovery = !isRepeat

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

    // Update state
    this.discoveredWords.add(normalized)
    this.discoveredRoots.add(root)
    this.ink += finalInk
    this.totalInkEarned += finalInk

    const result: ScoreResult = {
      word,
      baseValue,
      tierMultiplier,
      bonuses,
      finalInk,
      isRepeat,
      isNewDiscovery,
      isFirstInFamily,
    }

    this.lastScore = result
    this.lastScoreTime = performance.now()

    return result
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

/** Economy — scoring, ink tracking, discovered words, streaks. */

import { SCORING } from "./constants"
import type { GameState } from "./state"
import type { DictionaryEntry, ScoreBonus, ScoreResult, ShelfLetter } from "./types"

export class Economy {
  ink = 0
  totalInkEarned = 0
  discoveredWords = new Set<string>()
  discoveredRoots = new Set<string>()
  streak = 0

  /** Last score result for HUD flash. */
  lastScore: ScoreResult | null = null
  lastScoreTime = 0

  scoreWord(
    word: string,
    letters: ShelfLetter[],
    entry: DictionaryEntry | undefined,
  ): ScoreResult {
    const normalized = word.toLowerCase()
    const length = normalized.length
    const baseValue = Math.floor(Math.pow(length, 1.5))

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
        label: "First in Family",
        multiplier: SCORING.firstInFamilyBonus,
      })
    }

    // Uppercase opener bonus
    if (letters.length > 0 && letters[0]?.isUpper) {
      bonuses.push({
        label: "Uppercase",
        multiplier: SCORING.uppercaseOpenerBonus,
      })
    }

    // Streak bonus
    if (this.streak > 0) {
      const streakMult =
        1 +
        Math.min(
          this.streak * SCORING.streakBonusPerStep,
          SCORING.streakBonusCap,
        )
      bonuses.push({
        label: `Streak x${this.streak + 1}`,
        multiplier: streakMult,
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

    finalInk = Math.floor(finalInk)

    // Update state
    this.discoveredWords.add(normalized)
    this.discoveredRoots.add(root)
    this.streak++
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

  resetStreak() {
    this.streak = 0
  }

  creditLetterMined(): number {
    this.ink += SCORING.letterMinedInk
    this.totalInkEarned += SCORING.letterMinedInk
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
  toPartialState(submittedWords: string[]): Pick<
    GameState,
    "ink" | "totalInkEarned" | "discoveredWords" | "discoveredRoots" | "streak" | "submittedWords"
  > {
    return {
      ink: this.ink,
      totalInkEarned: this.totalInkEarned,
      discoveredWords: [...this.discoveredWords],
      discoveredRoots: [...this.discoveredRoots],
      streak: this.streak,
      submittedWords,
    }
  }

  fromState(state: GameState) {
    this.ink = state.ink
    this.totalInkEarned = state.totalInkEarned
    this.discoveredWords = new Set(state.discoveredWords)
    this.discoveredRoots = new Set(state.discoveredRoots)
    this.streak = state.streak
  }
}

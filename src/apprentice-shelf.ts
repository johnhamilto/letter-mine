/**
 * Apprentice Shelf — auto-assembles discovered words from basin letters.
 * Picks the highest-value word it can form, animates assembly, auto-submits.
 */

import { SCORING } from './constants'
import type { DictionaryEntry } from './types'
import type { LetterBody } from './types'

const ASSEMBLY_TIME_MS = 8000 // time to assemble one word
const COOLDOWN_MS = 2000 // pause between words

interface ApprenticeCallbacks {
  getLetters: () => LetterBody[]
  removeLetter: (letter: LetterBody) => void
  getDiscoveredWords: () => Set<string>
  getDictionary: () => Record<string, DictionaryEntry>
  onWordAssembled: (word: string) => void
}

export class ApprenticeShelf {
  private cb: ApprenticeCallbacks
  private assembling = false
  private cooldownUntil = 0
  private currentWord: string | null = null
  private progress = 0

  /** Max word length (from apprentice shelf width upgrade). */
  maxLength = 4

  /** When true, can discover new words (Auto-Discovery upgrade). */
  canDiscover = false

  constructor(cb: ApprenticeCallbacks) {
    this.cb = cb
  }

  update(dt: number) {
    const now = performance.now()

    if (this.assembling && this.currentWord) {
      this.progress += dt * 1000
      if (this.progress >= ASSEMBLY_TIME_MS) {
        this.completeAssembly()
        this.cooldownUntil = now + COOLDOWN_MS
      }
      return
    }

    if (now < this.cooldownUntil) return

    // Try to find a word to assemble
    const word = this.findBestWord()
    if (word) {
      this.currentWord = word
      this.assembling = true
      this.progress = 0
    }
  }

  private findBestWord(): string | null {
    const letters = this.cb.getLetters()
    const discovered = this.cb.getDiscoveredWords()
    const dictionary = this.cb.getDictionary()

    // Count available letters in basin
    const available = new Map<string, number>()
    for (const letter of letters) {
      const ch = letter.char.toLowerCase()
      available.set(ch, (available.get(ch) ?? 0) + 1)
    }

    let bestWord: string | null = null
    let bestValue = 0

    // Check discovered words (or all words if canDiscover)
    const candidates = this.canDiscover ? Object.keys(dictionary) : [...discovered]

    for (const word of candidates) {
      if (word.length < 4 || word.length > this.maxLength) continue
      if (!this.canDiscover && !discovered.has(word)) continue

      // Check if we have the letters
      const needed = new Map<string, number>()
      for (const ch of word) {
        needed.set(ch, (needed.get(ch) ?? 0) + 1)
      }
      let canForm = true
      for (const [ch, count] of needed) {
        if ((available.get(ch) ?? 0) < count) {
          canForm = false
          break
        }
      }
      if (!canForm) continue

      // Score it
      const entry = dictionary[word]
      const tier = entry?.tier ?? 0
      const tierMult = SCORING.tierMultipliers[tier] ?? 1
      const value = Math.floor(Math.pow(word.length, 1.5)) * tierMult
      if (value > bestValue) {
        bestValue = value
        bestWord = word
      }
    }

    return bestWord
  }

  private completeAssembly() {
    if (!this.currentWord) return

    const letters = this.cb.getLetters()
    const needed = new Map<string, number>()
    for (const ch of this.currentWord) {
      needed.set(ch, (needed.get(ch) ?? 0) + 1)
    }

    // Remove letters from basin
    for (const [ch, count] of needed) {
      let removed = 0
      for (let i = letters.length - 1; i >= 0 && removed < count; i--) {
        if (letters[i]!.char.toLowerCase() === ch) {
          this.cb.removeLetter(letters[i]!)
          removed++
        }
      }
    }

    this.cb.onWordAssembled(this.currentWord)
    this.assembling = false
    this.currentWord = null
    this.progress = 0
  }

  /** Get current assembly progress for rendering (0-1). */
  getProgress(): { word: string; progress: number } | null {
    if (!this.assembling || !this.currentWord) return null
    return {
      word: this.currentWord,
      progress: Math.min(1, this.progress / ASSEMBLY_TIME_MS),
    }
  }
}

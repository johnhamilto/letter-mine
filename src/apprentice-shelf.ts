/**
 * Apprentice Shelf — auto-assembles discovered words from basin letters.
 * Picks the highest-value word it can form, animates assembly, auto-submits.
 */

import { Container, Graphics, Text } from 'pixi.js'
import { COLORS } from './constants'
import type { DictionaryEntry } from './types'
import type { LetterBody } from './types'

const COOLDOWN_MS = 2000 // pause between words
const SEARCH_THROTTLE_MS = 500 // don't scan dictionary more than twice per second

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
  private lastSearchAt = 0
  private currentWord: string | null = null
  private progress = 0

  /** Max word length (from apprentice shelf width upgrade). */
  maxLength = 4

  /** Assembly time in ms (from apprentice speed upgrade). Lower = faster. */
  assemblyMs = 8000

  /** When true, the apprentice targets the HIGHEST-value undiscovered word (Auto-Discovery upgrade). */
  preferHighValue = false

  /** PixiJS container for the assembly display (positioned above the player shelf). */
  readonly container = new Container()
  private bg = new Graphics()
  private label: Text
  private progressBarBg = new Graphics()
  private progressBarFill = new Graphics()
  private letterTexts: Text[] = []
  private slotsGfx = new Graphics()

  private screenWidth = 0

  constructor(cb: ApprenticeCallbacks) {
    this.cb = cb

    this.container.addChild(this.bg)
    this.container.addChild(this.slotsGfx)

    this.label = new Text({
      text: 'APPRENTICE',
      style: {
        fontFamily: 'Playfair Display',
        fontSize: 10,
        fontWeight: 'bold',
        fill: COLORS.muted,
        letterSpacing: 1.5,
      },
    })
    this.container.addChild(this.label)

    this.container.addChild(this.progressBarBg)
    this.container.addChild(this.progressBarFill)
    this.container.visible = false
  }

  resize(screenWidth: number) {
    this.screenWidth = screenWidth
  }

  update(dt: number) {
    const now = performance.now()

    if (this.assembling && this.currentWord) {
      this.progress += dt * 1000
      if (this.progress >= this.assemblyMs) {
        this.completeAssembly()
        this.cooldownUntil = now + COOLDOWN_MS
      }
      return
    }

    if (now < this.cooldownUntil) return
    if (now - this.lastSearchAt < SEARCH_THROTTLE_MS) return
    this.lastSearchAt = now

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

    // Group formable undiscovered words by length, keeping only the preferred tier per length.
    // Tier scale: 0 = legendary, 4 = universal. Default prefers tier 4 (common); Specialist prefers 0 (rare).
    const byLength = new Map<number, { bestTier: number; words: string[] }>()

    for (const word in dictionary) {
      const len = word.length
      if (len < 4 || len > this.maxLength) continue
      if (discovered.has(word)) continue

      let canForm = true
      const needed = new Map<string, number>()
      for (const ch of word) {
        needed.set(ch, (needed.get(ch) ?? 0) + 1)
        if ((available.get(ch) ?? 0) < needed.get(ch)!) {
          canForm = false
          break
        }
      }
      if (!canForm) continue

      const tier = dictionary[word]?.tier ?? 0
      const bucket = byLength.get(len)
      if (!bucket) {
        byLength.set(len, { bestTier: tier, words: [word] })
      } else {
        const tierBetter = this.preferHighValue ? tier < bucket.bestTier : tier > bucket.bestTier
        if (tierBetter) {
          bucket.bestTier = tier
          bucket.words = [word]
        } else if (tier === bucket.bestTier) {
          bucket.words.push(word)
        }
      }
    }

    const lengths = [...byLength.keys()]
    if (lengths.length === 0) return null

    // Uniform random length, then random word within the preferred-tier pool for that length.
    const randomLength = lengths[Math.floor(Math.random() * lengths.length)]!
    const bucket = byLength.get(randomLength)!
    return bucket.words[Math.floor(Math.random() * bucket.words.length)] ?? null
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
    this.progress = this.assemblyMs
    // Keep currentWord so the bench continues to display the finished word during cooldown
  }

  /** Get the word currently displayed (assembling or recently completed) and its fill ratio. */
  getProgress(): { word: string; progress: number } | null {
    if (!this.currentWord) return null
    return {
      word: this.currentWord,
      progress: Math.min(1, this.progress / this.assemblyMs),
    }
  }

  /** Draw the assembly bench above `anchorBottomY`. Called each frame by Game. */
  render(anchorBottomY: number) {
    // Clean up prior frame's letter texts
    for (const t of this.letterTexts) {
      t.removeFromParent()
      t.destroy()
    }
    this.letterTexts.length = 0

    const prog = this.getProgress()
    if (!prog) {
      this.container.visible = false
      return
    }
    this.container.visible = true

    const word = prog.word
    const n = word.length
    const slotW = 24
    const slotGap = 3
    const slotH = 30
    const padX = 12
    const padY = 10
    const labelH = 14
    const progressH = 4
    const progressGap = 8

    const innerW = n * slotW + Math.max(0, n - 1) * slotGap
    const w = innerW + padX * 2
    const h = labelH + slotH + progressGap + progressH + padY * 2

    // Position centered, with bottom above the given anchor Y
    this.container.x = Math.round((this.screenWidth - w) / 2)
    this.container.y = Math.round(anchorBottomY - h)

    // Background
    this.bg.clear()
    this.bg.roundRect(0, 0, w, h, 6)
    this.bg.fill({ color: COLORS.shelfBg, alpha: 0.92 })
    this.bg.roundRect(0, 0, w, h, 6)
    this.bg.stroke({ color: COLORS.shelf, width: 1.5 })

    // Label
    this.label.x = padX
    this.label.y = padY

    // Letter slots
    const slotsY = padY + labelH
    this.slotsGfx.clear()
    for (let i = 0; i < n; i++) {
      const x = padX + i * (slotW + slotGap)
      this.slotsGfx.roundRect(x, slotsY, slotW, slotH, 3)
      this.slotsGfx.fill({ color: COLORS.shelfBg, alpha: 0 })
      this.slotsGfx.roundRect(x, slotsY, slotW, slotH, 3)
      this.slotsGfx.stroke({ color: COLORS.faded, width: 1 })
    }

    // Letters that have "arrived" based on progress
    const lettersArrived = Math.floor(prog.progress * n)
    for (let i = 0; i < lettersArrived; i++) {
      const t = new Text({
        text: word[i]!.toUpperCase(),
        style: {
          fontFamily: 'Playfair Display',
          fontSize: 20,
          fontWeight: 'bold',
          fill: COLORS.ink,
        },
      })
      t.anchor.set(0.5, 0.5)
      t.x = padX + i * (slotW + slotGap) + slotW / 2
      t.y = slotsY + slotH / 2
      this.container.addChild(t)
      this.letterTexts.push(t)
    }

    // Progress bar
    const progY = slotsY + slotH + progressGap
    this.progressBarBg.clear()
    this.progressBarBg.roundRect(padX, progY, innerW, progressH, 2)
    this.progressBarBg.fill({ color: COLORS.faded, alpha: 0.5 })

    this.progressBarFill.clear()
    if (prog.progress > 0) {
      this.progressBarFill.roundRect(padX, progY, innerW * prog.progress, progressH, 2)
      this.progressBarFill.fill(COLORS.valid)
    }
  }
}

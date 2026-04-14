/**
 * Apprentice Shelf — auto-assembles discovered words from basin letters.
 * Picks the highest-value word it can form, animates assembly, auto-submits.
 */

import { Container, Graphics, Text } from 'pixi.js'
import { COLORS } from './constants'
import type { ApprenticeWorkerInMsg, ApprenticeWorkerOutMsg } from './apprentice-worker'
import type { DictionaryEntry } from './types'
import type { LetterBody } from './types'

const SEARCH_THROTTLE_MS = 500 // don't scan dictionary more than twice per second when idle

interface ApprenticeCallbacks {
  getLetters: () => LetterBody[]
  removeLetter: (letter: LetterBody) => void
  getDiscoveredWords: () => Set<string>
  getDictionary: () => Record<string, DictionaryEntry>
  onWordAssembled: (word: string) => void
  /**
   * Returns letter counts reserved by OTHER apprentices currently assembling a word.
   * Optional — when omitted (single-apprentice deployments), no reservation is applied.
   */
  getBlockedLetters?: () => Map<string, number>
}

export class ApprenticeShelf {
  private cb: ApprenticeCallbacks
  private assembling = false
  private lastSearchAt = 0
  private currentWord: string | null = null
  private progress = 0

  /** Max word length (from apprentice shelf width upgrade). */
  maxLength = 4

  /** Assembly time in ms (from apprentice speed upgrade). Lower = faster. */
  assemblyMs = 8000

  /** When true, the apprentice targets the HIGHEST-value undiscovered word (Auto-Discovery upgrade). */
  preferHighValue = false

  // Worker state
  private worker: Worker
  private workerInitialized = false
  private searchPending = false
  private nextRequestId = 1
  private pendingRequestId = 0

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

    this.worker = new Worker(new URL('./apprentice-worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (e: MessageEvent<ApprenticeWorkerOutMsg>) => {
      const msg = e.data
      if (msg.type === 'found' && msg.id === this.pendingRequestId) {
        this.searchPending = false
        if (msg.word) {
          this.currentWord = msg.word
          this.assembling = true
          this.progress = 0
        }
      }
    }

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

  /** Send the dictionary to the worker. Idempotent — caller can re-call safely. */
  private ensureWorkerReady(dictionary: Record<string, DictionaryEntry>) {
    if (this.workerInitialized) return
    if (Object.keys(dictionary).length === 0) return
    const msg: ApprenticeWorkerInMsg = { type: 'init', dictionary }
    this.worker.postMessage(msg)
    this.workerInitialized = true
  }

  /** Dispose the worker — call when the game is torn down. */
  destroy() {
    this.worker.terminate()
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
      }
      return
    }

    if (this.searchPending) return
    if (now - this.lastSearchAt < SEARCH_THROTTLE_MS) return
    this.lastSearchAt = now

    this.requestFindAsync()
  }

  private requestFindAsync() {
    const dictionary = this.cb.getDictionary()
    this.ensureWorkerReady(dictionary)
    if (!this.workerInitialized) return

    const basinCounts: Record<string, number> = Object.create(null)
    for (const letter of this.cb.getLetters()) {
      const ch = letter.char.toLowerCase()
      basinCounts[ch] = (basinCounts[ch] ?? 0) + 1
    }

    // Subtract letters reserved by peer apprentices assembling in parallel.
    const blocked = this.cb.getBlockedLetters?.()
    if (blocked) {
      for (const [ch, n] of blocked) {
        basinCounts[ch] = Math.max(0, (basinCounts[ch] ?? 0) - n)
      }
    }

    this.pendingRequestId = this.nextRequestId++
    this.searchPending = true
    const msg: ApprenticeWorkerInMsg = {
      type: 'find',
      id: this.pendingRequestId,
      discovered: [...this.cb.getDiscoveredWords()],
      basinCounts,
      maxLength: this.maxLength,
      preferHighValue: this.preferHighValue,
    }
    this.worker.postMessage(msg)
  }

  /**
   * Letter counts this apprentice has committed to assembling right now.
   * Empty when idle or during the post-completion display window.
   */
  getReservedLetters(): Map<string, number> {
    const counts = new Map<string, number>()
    if (!this.assembling || !this.currentWord) return counts
    for (const ch of this.currentWord) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }
    return counts
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
    // Letters fill in during the first half of the cycle, then hold fully visible
    // for the second half so the word is actually readable.
    const fillT = Math.min(1, prog.progress * 2)
    const lettersArrived = Math.floor(fillT * n)
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

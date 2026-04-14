/**
 * Shelf -- foreground UI container for assembling words.
 * No physics body. Letters fall behind it.
 */

import { Container, Graphics, Text } from 'pixi.js'
import { SCALE, COLORS, SHELF } from './constants'
import type { ShelfLetter, WordStatus } from './types'

interface SubmitResult {
  valid: boolean
  word: string
  letters: ShelfLetter[]
  submittedLetters: ShelfLetter[]
}

const ERROR_FLASH_MS = 500
const TOOLTIP_MS = 1500

export class Shelf {
  letters: ShelfLetter[] = []
  maxSlots: number

  x = 0
  y = 0
  shelfWidth = 0
  shelfHeight = SHELF.height

  wordStatus: WordStatus = 'none'
  private dictionary: Set<string> | null = null
  private prefixes: Set<string> | null = null

  /** Pointer to economy's discovered words set. */
  discoveredWords: Set<string> | null = null

  /** When true, shows validation status and blocks invalid submissions. */
  wordCheckEnabled = false
  siphonActive = false

  onSubmit: (() => void) | null = null

  // Error flash state
  private errorTime = 0
  private errorMessage = ''

  // Submit button layout
  private btnX = 0
  private btnY = 0
  private btnW = 70
  private btnH = 32

  /** PixiJS container for shelf rendering. */
  readonly container = new Container()
  private bg = new Graphics()
  private letterTexts: Text[] = []
  private submitBtn: Graphics | null = null
  private submitBtnText: Text | null = null
  private placeholderText: Text | null = null
  private errorText: Text | null = null
  private cursorGfx: Graphics | null = null

  constructor(initialSlots: number = SHELF.maxSlots) {
    this.maxSlots = initialSlots
    this.container.addChild(this.bg)
  }

  loadDictionary(dict: Set<string>) {
    this.dictionary = dict
    this.prefixes = new Set<string>()
    for (const word of dict) {
      for (let i = 1; i < word.length; i++) {
        this.prefixes.add(word.substring(0, i))
      }
    }
  }

  rebuild(screenWidth: number, screenHeight: number) {
    this.y = Math.round(screenHeight * SHELF.yRatio)
    this.x = SHELF.margin
    this.shelfWidth = screenWidth - SHELF.margin * 2
  }

  get rect() {
    return {
      x: this.x,
      y: this.y - this.shelfHeight / 2,
      w: this.shelfWidth,
      h: this.shelfHeight,
    }
  }

  private get effectiveSlotWidth(): number {
    return Math.min(SHELF.slotWidth, (this.shelfWidth - 20) / Math.max(this.maxSlots, 1))
  }

  private get effectiveSlotGap(): number {
    return Math.min(SHELF.slotGap, this.effectiveSlotWidth * 0.12)
  }

  slotPosition(index: number): { x: number; y: number } {
    const count = Math.max(this.letters.length, 1)
    const sw = this.effectiveSlotWidth
    const sg = this.effectiveSlotGap
    const totalWidth = count * sw + Math.max(0, count - 1) * sg
    const startX = this.x + (this.shelfWidth - totalWidth) / 2
    return {
      x: startX + index * (sw + sg) + sw / 2,
      y: this.y,
    }
  }

  isOverShelf(screenX: number, screenY: number): boolean {
    const r = this.rect
    return screenX >= r.x && screenX <= r.x + r.w && screenY >= r.y && screenY <= r.y + r.h
  }

  private flashError(message: string) {
    this.errorTime = performance.now()
    this.errorMessage = message
  }

  placeLetter(char: string, isUpper: boolean): boolean {
    if (this.letters.length >= this.maxSlots) {
      this.flashError(`${this.maxSlots} letters max`)
      return false
    }
    this.letters.push({ char, isUpper })
    this.validate()
    return true
  }

  insertLetter(index: number, char: string, isUpper: boolean): boolean {
    if (this.letters.length >= this.maxSlots) {
      this.flashError(`${this.maxSlots} letters max`)
      return false
    }
    this.letters.splice(index, 0, { char, isUpper })
    this.validate()
    return true
  }

  removeLetter(index: number): ShelfLetter | null {
    if (index < 0 || index >= this.letters.length) return null
    const removed = this.letters.splice(index, 1)[0]!
    this.validate()
    return removed
  }

  moveLetter(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return
    if (fromIdx < 0 || fromIdx >= this.letters.length) return
    const letter = this.letters.splice(fromIdx, 1)[0]!
    const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx
    this.letters.splice(Math.min(insertAt, this.letters.length), 0, letter)
    this.validate()
  }

  currentWord(): string {
    return this.letters.map((l) => l.char.toLowerCase()).join('')
  }

  displayWord(): string {
    return this.letters.map((l) => l.char).join('')
  }

  /**
   * Returns lowercase chars that lead to a completable dictionary word within maxSlots,
   * given the letter counts available in the basin.
   *
   * Uses DFS with pruning on the prefix set and basin availability. Caller is responsible
   * for caching the result — each call runs up to 26 bounded DFS queries.
   */
  getCompletionChars(basinCounts: Map<string, number>): Set<string> {
    const result = new Set<string>()
    if (this.letters.length < 3 || !this.dictionary || !this.prefixes) return result

    const prefix = this.currentWord()
    const counts = new Map(basinCounts)

    for (let c = 97; c <= 122; c++) {
      const ch = String.fromCharCode(c)
      if ((counts.get(ch) ?? 0) === 0) continue

      const next = prefix + ch
      if (!this.prefixes.has(next) && !this.dictionary.has(next)) continue

      counts.set(ch, counts.get(ch)! - 1)
      if (this.canReachWord(next, this.maxSlots, counts)) {
        result.add(ch)
      }
      counts.set(ch, counts.get(ch)! + 1)
    }
    return result
  }

  private canReachWord(prefix: string, maxLen: number, counts: Map<string, number>): boolean {
    if (prefix.length >= 4 && this.dictionary!.has(prefix)) return true
    if (prefix.length >= maxLen) return false

    for (let c = 97; c <= 122; c++) {
      const ch = String.fromCharCode(c)
      if ((counts.get(ch) ?? 0) === 0) continue

      const next = prefix + ch
      if (!this.prefixes!.has(next) && !this.dictionary!.has(next)) continue

      counts.set(ch, counts.get(ch)! - 1)
      const found = this.canReachWord(next, maxLen, counts)
      counts.set(ch, counts.get(ch)! + 1)
      if (found) return true
    }
    return false
  }

  private validate() {
    if (this.letters.length < 4) {
      this.wordStatus = 'none'
      return
    }
    const word = this.currentWord()
    if (this.dictionary?.has(word)) {
      this.wordStatus = 'valid'
    } else if (this.prefixes?.has(word)) {
      this.wordStatus = 'prefix'
    } else {
      this.wordStatus = 'none'
    }
  }

  submit(): SubmitResult {
    if (this.letters.length === 0) {
      return { valid: false, word: '', letters: [], submittedLetters: [] }
    }

    const word = this.displayWord()
    const submittedLetters = [...this.letters]

    if (this.letters.length < 4) {
      this.flashError('Too short (4 letters min)')
      return { valid: false, word, letters: [], submittedLetters: [] }
    }

    if (this.wordStatus === 'valid') {
      this.letters = []
      this.wordStatus = 'none'
      return { valid: true, word, letters: [], submittedLetters }
    }

    if (this.wordCheckEnabled) {
      this.flashError('Not a word')
      return { valid: false, word, letters: [], submittedLetters: [] }
    }

    const cleared = [...this.letters]
    this.letters = []
    this.wordStatus = 'none'
    return { valid: false, word, letters: cleared, submittedLetters: [] }
  }

  clear(): ShelfLetter[] {
    const cleared = [...this.letters]
    this.letters = []
    this.wordStatus = 'none'
    return cleared
  }

  nearestSlotIndex(screenX: number): number {
    if (this.letters.length === 0) return 0
    const sw = this.effectiveSlotWidth
    const sg = this.effectiveSlotGap
    const totalWidth = this.letters.length * sw + Math.max(0, this.letters.length - 1) * sg
    const startX = this.x + (this.shelfWidth - totalWidth) / 2
    const relX = screenX - startX
    const idx = Math.round(relX / (sw + sg))
    return Math.max(0, Math.min(this.letters.length, idx))
  }

  isSubmitButtonAt(screenX: number, screenY: number): boolean {
    return (
      this.letters.length > 0 &&
      screenX >= this.btnX &&
      screenX <= this.btnX + this.btnW &&
      screenY >= this.btnY &&
      screenY <= this.btnY + this.btnH
    )
  }

  letterIndexAt(screenX: number, screenY: number): number {
    if (!this.isOverShelf(screenX, screenY)) return -1
    const sw = this.effectiveSlotWidth
    for (let i = 0; i < this.letters.length; i++) {
      const pos = this.slotPosition(i)
      if (
        Math.abs(screenX - pos.x) < sw / 2 + 2 &&
        Math.abs(screenY - pos.y) < this.shelfHeight / 2
      ) {
        return i
      }
    }
    return -1
  }

  render() {
    const r = this.rect
    const now = performance.now()
    const errorElapsed = now - this.errorTime
    const isShaking = errorElapsed < ERROR_FLASH_MS

    // Clean up previous frame's dynamic elements
    if (this.cursorGfx) {
      this.cursorGfx.removeFromParent()
      this.cursorGfx.destroy()
      this.cursorGfx = null
    }
    for (const t of this.letterTexts) {
      t.removeFromParent()
      t.destroy()
    }
    this.letterTexts.length = 0
    if (this.submitBtn) {
      this.submitBtn.removeFromParent()
      this.submitBtn.destroy()
      this.submitBtn = null
    }
    if (this.submitBtnText) {
      this.submitBtnText.removeFromParent()
      this.submitBtnText.destroy()
      this.submitBtnText = null
    }
    if (this.placeholderText) {
      this.placeholderText.removeFromParent()
      this.placeholderText.destroy()
      this.placeholderText = null
    }
    if (this.errorText) {
      this.errorText.removeFromParent()
      this.errorText.destroy()
      this.errorText = null
    }
    // Container background
    this.bg.clear()
    this.bg.roundRect(r.x, r.y, r.w, r.h, SHELF.cornerRadius)
    this.bg.fill(COLORS.shelfBg)
    this.bg.roundRect(r.x, r.y, r.w, r.h, SHELF.cornerRadius)
    this.bg.stroke({
      color: isShaking ? COLORS.error : COLORS.shelf,
      width: SHELF.borderWidth,
    })

    if (this.letters.length === 0 && !this.siphonActive) {
      this.placeholderText = new Text({
        text: 'click or drag letters here',
        style: {
          fontFamily: 'Playfair Display',
          fontSize: 18,
          fontStyle: 'italic',
          fill: COLORS.muted,
          align: 'center',
        },
      })
      this.placeholderText.anchor.set(0.5, 0.5)
      this.placeholderText.position.set(r.x + r.w / 2, r.y + r.h / 2)
      this.container.addChild(this.placeholderText)
    } else {
      // Submit button
      this.btnX = r.x + r.w - this.btnW - 10
      this.btnY = r.y + (r.h - this.btnH) / 2

      this.submitBtn = new Graphics()
      this.submitBtn.roundRect(this.btnX, this.btnY, this.btnW, this.btnH, 4)
      this.submitBtn.fill(COLORS.valid)
      this.container.addChild(this.submitBtn)

      this.submitBtnText = new Text({
        text: 'Submit',
        style: {
          fontFamily: 'Playfair Display',
          fontSize: 14,
          fontWeight: 'bold',
          fill: COLORS.shelfBg,
          align: 'center',
        },
      })
      this.submitBtnText.anchor.set(0.5, 0.5)
      this.submitBtnText.position.set(this.btnX + this.btnW / 2, this.btnY + this.btnH / 2)
      this.container.addChild(this.submitBtnText)

      const isDiscovered =
        this.discoveredWords !== null &&
        this.letters.length >= 4 &&
        this.discoveredWords.has(this.currentWord())

      const sw = this.effectiveSlotWidth
      const fontSize = Math.min(SCALE * 0.6, sw * 1.2)

      for (let i = 0; i < this.letters.length; i++) {
        const sl = this.letters[i]!
        const pos = this.slotPosition(i)

        let shakeX = 0
        if (isShaking) {
          const t = errorElapsed / ERROR_FLASH_MS
          shakeX = Math.sin(t * Math.PI * 6) * 4 * (1 - t)
        }

        let fill: string
        if (isShaking) {
          fill = COLORS.error
        } else if (isDiscovered) {
          fill = COLORS.valid
        } else {
          fill = sl.isUpper ? COLORS.inkDark : COLORS.ink
        }

        const letterText = new Text({
          text: sl.char,
          style: {
            fontFamily: 'Playfair Display',
            fontSize,
            fontWeight: 'bold',
            fill,
            align: 'center',
          },
        })
        letterText.anchor.set(0.5, 0.5)
        letterText.position.set(pos.x + shakeX, pos.y)
        this.container.addChild(letterText)
        this.letterTexts.push(letterText)
      }
    }

    // Siphon cursor — underscore after the last letter
    if (this.siphonActive && this.letters.length < this.maxSlots) {
      const cursorIdx = this.letters.length
      const pos = this.slotPosition(cursorIdx)
      const sw = this.effectiveSlotWidth
      this.cursorGfx = new Graphics()
      this.cursorGfx.rect(pos.x - sw / 2, pos.y + 20, sw, 2.5)
      this.cursorGfx.fill(COLORS.valid)
      this.container.addChild(this.cursorGfx)
    }

    // Error tooltip
    if (this.errorMessage && errorElapsed < TOOLTIP_MS) {
      const tooltipAlpha =
        errorElapsed < ERROR_FLASH_MS
          ? 1
          : 1 - (errorElapsed - ERROR_FLASH_MS) / (TOOLTIP_MS - ERROR_FLASH_MS)

      this.errorText = new Text({
        text: this.errorMessage,
        style: {
          fontFamily: 'Playfair Display',
          fontSize: 13,
          fontWeight: 'bold',
          fill: COLORS.error,
          align: 'center',
        },
      })
      this.errorText.anchor.set(0.5, 1)
      this.errorText.position.set(r.x + r.w / 2, r.y + r.h + 18)
      this.errorText.alpha = Math.max(0, tooltipAlpha)
      this.container.addChild(this.errorText)
    }
  }
}

/**
 * Shelf — foreground UI container for assembling words.
 * No physics body. Letters fall behind it.
 */

import { SCALE, COLORS, SHELF, FONT_FAMILY } from "./constants"
import type { ShelfLetter, WordStatus } from "./types"

interface SubmitResult {
  valid: boolean
  word: string
  letters: ShelfLetter[] // letters to dump back on invalid
  submittedLetters: ShelfLetter[] // letters that were on shelf (for scoring)
}

export class Shelf {
  letters: ShelfLetter[] = []
  maxSlots: number

  x = 0
  y = 0
  shelfWidth = 0
  shelfHeight = SHELF.height

  wordStatus: WordStatus = "none"
  private dictionary: Set<string> | null = null
  private prefixes: Set<string> | null = null

  /** Pointer to economy's discovered words set. */
  discoveredWords: Set<string> | null = null

  submittedWords: string[] = []
  onSubmit: (() => void) | null = null

  // Submit button layout
  private btnX = 0
  private btnY = 0
  private btnW = 70
  private btnH = 32

  constructor(initialSlots: number = SHELF.maxSlots) {
    this.maxSlots = initialSlots
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
    return (
      screenX >= r.x &&
      screenX <= r.x + r.w &&
      screenY >= r.y &&
      screenY <= r.y + r.h
    )
  }

  placeLetter(char: string, isUpper: boolean): boolean {
    if (this.letters.length >= this.maxSlots) return false
    this.letters.push({ char, isUpper })
    this.validate()
    return true
  }

  insertLetter(index: number, char: string, isUpper: boolean): boolean {
    if (this.letters.length >= this.maxSlots) return false
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
    return this.letters.map((l) => l.char.toLowerCase()).join("")
  }

  displayWord(): string {
    return this.letters.map((l) => l.char).join("")
  }

  private validate() {
    if (this.letters.length < 4) {
      this.wordStatus = "none"
      return
    }
    const word = this.currentWord()
    if (this.dictionary?.has(word)) {
      this.wordStatus = "valid"
    } else if (this.prefixes?.has(word)) {
      this.wordStatus = "prefix"
    } else {
      this.wordStatus = "none"
    }
  }

  submit(): SubmitResult {
    if (this.letters.length === 0) {
      return { valid: false, word: "", letters: [], submittedLetters: [] }
    }

    const word = this.displayWord()
    const submittedLetters = [...this.letters]

    if (this.letters.length < 4) {
      return { valid: false, word, letters: [], submittedLetters: [] }
    }

    if (this.wordStatus === "valid") {
      this.submittedWords.push(word)
      this.letters = []
      this.wordStatus = "none"
      return { valid: true, word, letters: [], submittedLetters }
    }

    // Invalid — return letters to be dumped
    const cleared = [...this.letters]
    this.letters = []
    this.wordStatus = "none"
    return { valid: false, word, letters: cleared, submittedLetters: [] }
  }

  clear(): ShelfLetter[] {
    const cleared = [...this.letters]
    this.letters = []
    this.wordStatus = "none"
    return cleared
  }

  nearestSlotIndex(screenX: number): number {
    if (this.letters.length === 0) return 0
    const sw = this.effectiveSlotWidth
    const sg = this.effectiveSlotGap
    const totalWidth =
      this.letters.length * sw + Math.max(0, this.letters.length - 1) * sg
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

  render(ctx: CanvasRenderingContext2D) {
    const r = this.rect

    // Container
    ctx.fillStyle = COLORS.shelfBg
    ctx.beginPath()
    ctx.roundRect(r.x, r.y, r.w, r.h, SHELF.cornerRadius)
    ctx.fill()

    ctx.strokeStyle = COLORS.shelf
    ctx.lineWidth = SHELF.borderWidth
    ctx.beginPath()
    ctx.roundRect(r.x, r.y, r.w, r.h, SHELF.cornerRadius)
    ctx.stroke()

    if (this.letters.length === 0) {
      ctx.fillStyle = COLORS.muted
      ctx.font = `italic 18px ${FONT_FAMILY}`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText("click or drag letters here", r.x + r.w / 2, r.y + r.h / 2)
    } else {
      // Submit button (right side of container)
      this.btnX = r.x + r.w - this.btnW - 10
      this.btnY = r.y + (r.h - this.btnH) / 2
      ctx.fillStyle = COLORS.valid
      ctx.beginPath()
      ctx.roundRect(this.btnX, this.btnY, this.btnW, this.btnH, 4)
      ctx.fill()
      ctx.fillStyle = COLORS.shelfBg
      ctx.font = `bold 14px ${FONT_FAMILY}`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText("Submit", this.btnX + this.btnW / 2, this.btnY + this.btnH / 2)

      // Letters — green if current word is already discovered
      const isDiscovered =
        this.discoveredWords !== null &&
        this.letters.length >= 4 &&
        this.discoveredWords.has(this.currentWord())

      const sw = this.effectiveSlotWidth
      const fontSize = Math.min(SCALE * 0.6, sw * 1.2)
      ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"

      for (let i = 0; i < this.letters.length; i++) {
        const sl = this.letters[i]!
        const pos = this.slotPosition(i)
        if (isDiscovered) {
          ctx.fillStyle = COLORS.valid
        } else {
          ctx.fillStyle = sl.isUpper ? COLORS.inkDark : COLORS.ink
        }
        ctx.fillText(sl.char, pos.x, pos.y)
      }
    }

    // Letter count hint (when building but below minimum)
    if (this.letters.length > 0 && this.letters.length < 4) {
      ctx.fillStyle = COLORS.faded
      ctx.font = `13px ${FONT_FAMILY}`
      ctx.textAlign = "center"
      ctx.textBaseline = "alphabetic"
      ctx.fillText(
        `${this.letters.length} / 4 min`,
        r.x + r.w / 2,
        r.y + r.h + 18,
      )
    }

    // Recent submissions
    if (this.submittedWords.length > 0) {
      ctx.fillStyle = COLORS.muted
      ctx.font = `14px ${FONT_FAMILY}`
      ctx.textAlign = "right"
      ctx.textBaseline = "alphabetic"
      const recent = this.submittedWords.slice(-5)
      for (let i = 0; i < recent.length; i++) {
        ctx.fillText(recent[i]!, r.x + r.w, r.y + r.h + 20 + i * 18)
      }
    }
  }
}

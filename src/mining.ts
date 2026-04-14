/**
 * Mining prompt -- lines of text at the top of the screen.
 * Line breaking powered by @chenglou/pretext.
 * Renders to an OffscreenCanvas, displayed as a PixiJS Sprite.
 */

import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
import { Container, Sprite, Texture } from 'pixi.js'
import { COLORS, MINING, PROMPT_FONT } from './constants'
import type { MarkovGenerator } from './markov'

interface PromptChar {
  char: string
  mined: boolean
  mineTime: number
  mistakeTime: number
}

interface PromptLine {
  text: string
  chars: PromptChar[]
  startIdx: number
}

interface MiningOptions {
  onLetterMined: (char: string, screenX: number, screenY: number) => void
  onKeystroke?: () => void
}

export class MiningPrompt {
  markov: MarkovGenerator | null = null
  private onLetterMined: MiningOptions['onLetterMined']
  private onKeystroke: MiningOptions['onKeystroke']

  paused = false

  private lines: PromptLine[] = []
  private cursorPos = 0
  private wordCount = 0

  private topLineIdx = 0
  private scrollOffset = 0

  private charScreenPositions = new Map<number, { x: number; y: number }>()

  /** PixiJS container for mining text. */
  readonly container = new Container()
  private sprite: Sprite
  private canvas: OffscreenCanvas
  private ctx: OffscreenCanvasRenderingContext2D
  private currentWidth = 0
  private dpr = window.devicePixelRatio

  constructor(options: MiningOptions) {
    this.onLetterMined = options.onLetterMined
    this.onKeystroke = options.onKeystroke

    this.canvas = new OffscreenCanvas(1, 1)
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Cannot create mining canvas')
    this.ctx = ctx

    this.sprite = new Sprite()
    this.sprite.position.set(0, 0)
    this.container.addChild(this.sprite)

    window.addEventListener('keydown', this.handleKey)
  }

  private generateText(wordCount: number): string {
    if (!this.markov) return ''
    const words = this.markov.generateWords(wordCount)
    this.wordCount += words.length
    return words.join(' ')
  }

  private buildLines(screenWidth: number): PromptLine[] {
    const maxWidth = screenWidth - MINING.padX * 2
    const text = this.generateText(40)

    const prepared = prepareWithSegments(text, PROMPT_FONT)
    const result = layoutWithLines(prepared, maxWidth, MINING.lineHeight)

    const lines: PromptLine[] = []
    let globalIdx = this.totalChars()

    for (const line of result.lines) {
      const lineText = line.text.replace(/\s+$/, '')
      const chars: PromptChar[] = []
      for (const ch of lineText) {
        chars.push({ char: ch, mined: false, mineTime: 0, mistakeTime: 0 })
      }
      lines.push({ text: lineText, chars, startIdx: globalIdx })
      globalIdx += chars.length
    }

    return lines
  }

  private totalChars(): number {
    let n = 0
    for (const line of this.lines) n += line.chars.length
    return n
  }

  private charAtGlobal(idx: number): { line: PromptLine; lineIdx: number; charIdx: number } | null {
    for (let li = 0; li < this.lines.length; li++) {
      const line = this.lines[li]!
      if (idx >= line.startIdx && idx < line.startIdx + line.chars.length) {
        return { line, lineIdx: li, charIdx: idx - line.startIdx }
      }
    }
    return null
  }

  private handleKey = (e: KeyboardEvent) => {
    if (this.paused) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key.length !== 1) return
    e.preventDefault()

    const info = this.charAtGlobal(this.cursorPos)
    if (!info) return

    const pc = info.line.chars[info.charIdx]!
    const now = performance.now()

    if (e.key === ' ' && pc.char !== ' ') return

    if (pc.char === ' ') {
      if (e.key === ' ') {
        pc.mined = true
        pc.mineTime = now
        this.cursorPos++
        this.onKeystroke?.()
      }
      return
    }

    if (e.key === pc.char) {
      pc.mined = true
      pc.mineTime = now

      const pos = this.charScreenPositions.get(this.cursorPos)
      if (pos) {
        this.onLetterMined(pc.char, pos.x, pos.y)
      }

      this.cursorPos++
      this.onKeystroke?.()
    } else {
      pc.mistakeTime = now
      this.onKeystroke?.()
    }
  }

  /** Auto-mine the next character. Called by AutoMiner. */
  mineNext() {
    const info = this.charAtGlobal(this.cursorPos)
    if (!info) return

    const pc = info.line.chars[info.charIdx]!
    const now = performance.now()

    if (pc.char === ' ') {
      pc.mined = true
      pc.mineTime = now
      this.cursorPos++
      this.onKeystroke?.()
      return
    }

    pc.mined = true
    pc.mineTime = now
    const pos = this.charScreenPositions.get(this.cursorPos)
    if (pos) {
      this.onLetterMined(pc.char, pos.x, pos.y)
    }
    this.cursorPos++
    this.onKeystroke?.()
  }

  render(screenWidth: number) {
    const now = performance.now()

    if (this.lines.length === 0) {
      this.lines = this.buildLines(screenWidth)
    }

    const cursorInfo = this.charAtGlobal(this.cursorPos)
    if (cursorInfo && cursorInfo.lineIdx >= this.lines.length - MINING.maxVisibleLines) {
      this.lines.push(...this.buildLines(screenWidth))
    }

    const cursorLineIdx = cursorInfo?.lineIdx ?? 0
    this.topLineIdx = cursorLineIdx

    const targetScrollY = this.topLineIdx * MINING.lineHeight
    this.scrollOffset += (targetScrollY - this.scrollOffset) * 0.15
    if (Math.abs(targetScrollY - this.scrollOffset) < 0.5) {
      this.scrollOffset = targetScrollY
    }

    // Resize canvas if screen width changed (render at DPR scale for sharpness)
    const dpr = this.dpr
    const canvasHeight = MINING.lineHeight * 4
    if (this.currentWidth !== screenWidth) {
      this.currentWidth = screenWidth
      this.canvas.width = screenWidth * dpr
      this.canvas.height = canvasHeight * dpr
    }

    const ctx = this.ctx
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.save()
    ctx.scale(dpr, dpr)

    this.charScreenPositions.clear()

    const firstVisible = Math.max(0, cursorLineIdx - 1)
    const lastVisible = cursorLineIdx + 2

    for (let li = firstVisible; li < Math.min(lastVisible, this.lines.length); li++) {
      const line = this.lines[li]!
      const lineBaseY = MINING.firstLineY + li * MINING.lineHeight - this.scrollOffset

      ctx.font = PROMPT_FONT
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'

      for (let ci = 0; ci < line.chars.length; ci++) {
        const pc = line.chars[ci]!
        const globalIdx = line.startIdx + ci

        const x = MINING.padX + ctx.measureText(line.text.substring(0, ci)).width
        const charWidth =
          ctx.measureText(line.text.substring(0, ci + 1)).width -
          ctx.measureText(line.text.substring(0, ci)).width

        this.charScreenPositions.set(globalIdx, {
          x: x + charWidth / 2,
          y: lineBaseY,
        })

        if (pc.char === ' ') {
          if (!this.paused && globalIdx === this.cursorPos && !pc.mined) {
            ctx.globalAlpha = 1
            ctx.fillStyle = COLORS.valid
            ctx.fillRect(x, lineBaseY + 4, charWidth, 2.5)
          }
          continue
        }

        if (pc.mined) continue

        // Mistake shake
        let shakeX = 0
        let isMistake = false
        if (pc.mistakeTime > 0) {
          const elapsed = now - pc.mistakeTime
          if (elapsed < MINING.mistakeAnimMs) {
            isMistake = true
            const t = elapsed / MINING.mistakeAnimMs
            shakeX = Math.sin(t * Math.PI * 4) * 4 * (1 - t)
          } else {
            pc.mistakeTime = 0
          }
        }

        if (isMistake) {
          ctx.fillStyle = COLORS.error
        } else if (globalIdx === this.cursorPos) {
          ctx.fillStyle = COLORS.ink
        } else {
          ctx.fillStyle = COLORS.faded
        }

        ctx.globalAlpha = 1
        ctx.fillText(pc.char, x + shakeX, lineBaseY)

        if (!this.paused && globalIdx === this.cursorPos && !pc.mined) {
          ctx.fillStyle = COLORS.valid
          ctx.fillRect(x, lineBaseY + 4, charWidth, 2.5)
        }
      }
    }

    ctx.restore()

    // Update sprite texture from canvas (with DPR resolution for sharpness)
    const oldTexture = this.sprite.texture
    if (oldTexture !== Texture.EMPTY) {
      oldTexture.destroy(true)
    }
    this.sprite.texture = Texture.from({
      resource: this.canvas.transferToImageBitmap(),
      resolution: dpr,
    })
  }

  destroy() {
    window.removeEventListener('keydown', this.handleKey)
  }
}

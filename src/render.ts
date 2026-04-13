/** Glyph caching and letter rendering. */

import { SCALE, COLORS, FONT_FAMILY } from './constants'
import type { GlyphData, LetterBody } from './types'

export class LetterRenderer {
  private cache = new Map<string, OffscreenCanvas>()
  showGlyphs = true
  showColliders = false

  private getCachedGlyph(glyph: GlyphData, isUpper: boolean, scale: number): OffscreenCanvas {
    const key = `${glyph.char}_${scale}`
    const cached = this.cache.get(key)
    if (cached) return cached

    const fontSize = SCALE * scale
    const s = fontSize / 100
    const dpr = window.devicePixelRatio

    const pad = 4
    const w = Math.ceil(glyph.width * s) + pad * 2
    const h = Math.ceil(glyph.height * s) + pad * 2

    const oc = new OffscreenCanvas(w * dpr, h * dpr)
    const octx = oc.getContext('2d')!
    octx.scale(dpr, dpr)

    octx.fillStyle = isUpper ? COLORS.inkDark : COLORS.ink
    octx.font = `bold ${fontSize}px ${FONT_FAMILY}`
    octx.textBaseline = 'alphabetic'
    octx.textAlign = 'left'

    octx.fillText(glyph.char, -glyph.offsetX * s + pad, -glyph.offsetY * s + pad)

    this.cache.set(key, oc)
    return oc
  }

  renderLetter(
    ctx: CanvasRenderingContext2D,
    letter: LetterBody,
    dpr: number,
    highlighted = false,
    glowColor: string | null = null,
  ) {
    const glyph = letter.glyph
    const scale = letter.renderScale

    ctx.save()
    ctx.translate(letter.x * SCALE, letter.y * SCALE)
    ctx.rotate(letter.rotation)

    if (this.showGlyphs) {
      const oc = this.getCachedGlyph(glyph, letter.isUpper, scale)
      const fontSize = SCALE * scale
      const s = fontSize / 100
      const pad = 4

      if (highlighted) {
        ctx.shadowColor = COLORS.shelf
        ctx.shadowBlur = 16
      } else if (glowColor) {
        ctx.shadowColor = glowColor
        ctx.shadowBlur = 12
      }

      ctx.drawImage(
        oc,
        -(glyph.width / 2) * s - pad,
        -(glyph.height / 2) * s - pad,
        oc.width / dpr,
        oc.height / dpr,
      )

      if (highlighted || glowColor) {
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
      }
    }

    ctx.restore()
  }
}

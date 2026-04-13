/** Glyph rendering with PixiJS — texture cache and sprite management. */

import { Sprite, Texture, Container } from 'pixi.js'
import { SCALE, COLORS, FONT_FAMILY } from './constants'
import type { GlyphData, LetterBody } from './types'

export class LetterRenderer {
  private textureCache = new Map<string, Texture>()
  private spriteMap = new Map<LetterBody, Sprite>()
  showGlyphs = true
  showColliders = false

  /** Container for basin letters (behind shelf). */
  readonly basinLayer = new Container()
  /** Container for foreground letters (above shelf). */
  readonly foregroundLayer = new Container()
  /** Container for the dragged letter (topmost). */
  readonly dragLayer = new Container()

  private getTexture(glyph: GlyphData, isUpper: boolean, scale: number): Texture {
    const key = `${glyph.char}_${scale}`
    const cached = this.textureCache.get(key)
    if (cached) return cached

    const fontSize = SCALE * scale
    const s = fontSize / 100

    const pad = 4
    const w = Math.ceil(glyph.width * s) + pad * 2
    const h = Math.ceil(glyph.height * s) + pad * 2

    const oc = new OffscreenCanvas(w, h)
    const octx = oc.getContext('2d')
    if (!octx) throw new Error('No 2d context on OffscreenCanvas')

    octx.fillStyle = isUpper ? COLORS.inkDark : COLORS.ink
    octx.font = `bold ${fontSize}px ${FONT_FAMILY}`
    octx.textBaseline = 'alphabetic'
    octx.textAlign = 'left'

    octx.fillText(glyph.char, -glyph.offsetX * s + pad, -glyph.offsetY * s + pad)

    const texture = Texture.from(oc.transferToImageBitmap())

    this.textureCache.set(key, texture)
    return texture
  }

  /** Create a sprite for a newly spawned letter. */
  createSprite(letter: LetterBody): Sprite {
    const texture = this.getTexture(letter.glyph, letter.isUpper, letter.renderScale)
    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5, 0.5)
    sprite.visible = this.showGlyphs
    this.spriteMap.set(letter, sprite)
    this.basinLayer.addChild(sprite)
    return sprite
  }

  /** Remove the sprite for a destroyed letter. */
  removeSprite(letter: LetterBody) {
    const sprite = this.spriteMap.get(letter)
    if (sprite) {
      sprite.removeFromParent()
      sprite.destroy()
      this.spriteMap.delete(letter)
    }
  }

  /** Get the sprite for a letter (may be null if not yet created). */
  getSprite(letter: LetterBody): Sprite | undefined {
    return this.spriteMap.get(letter)
  }

  /** Update sprite position/rotation from physics state. */
  updateSprite(letter: LetterBody, highlighted = false, glowColor: string | null = null) {
    const sprite = this.spriteMap.get(letter)
    if (!sprite) return

    sprite.position.set(letter.x * SCALE, letter.y * SCALE)
    sprite.rotation = letter.rotation
    sprite.visible = this.showGlyphs

    if (highlighted) {
      sprite.alpha = 0.85
    } else if (glowColor) {
      sprite.alpha = 0.9
    } else {
      sprite.alpha = 1
    }
  }

  /** Move a sprite to a specific container layer. */
  moveToLayer(letter: LetterBody, layer: Container) {
    const sprite = this.spriteMap.get(letter)
    if (sprite && sprite.parent !== layer) {
      layer.addChild(sprite)
    }
  }
}

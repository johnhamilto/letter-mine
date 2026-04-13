/** Glyph rendering with PixiJS — texture cache and sprite management. */

import { Sprite, Texture, Container } from 'pixi.js'
import { SCALE, COLORS, FONT_FAMILY } from './constants'
import type { GlyphData, LetterBody } from './types'

export class LetterRenderer {
  private textureCache = new Map<string, Texture>()
  private spriteMap = new Map<LetterBody, Sprite>()
  private glowMap = new Map<LetterBody, { sprite: Sprite; color: string }>()
  showGlyphs = true
  showColliders = false

  /** Container for basin letters (behind shelf). */
  readonly basinLayer = new Container()
  /** Container for foreground letters (above shelf). */
  readonly foregroundLayer = new Container()
  /** Container for the dragged letter (topmost). */
  readonly dragLayer = new Container()

  private getTexture(glyph: GlyphData, isUpper: boolean, scale: number): Texture {
    const dpr = window.devicePixelRatio
    const key = `${glyph.char}_${scale}_${dpr}`
    const cached = this.textureCache.get(key)
    if (cached) return cached

    const fontSize = SCALE * scale
    const s = fontSize / 100

    const pad = 4
    const logicalW = Math.ceil(glyph.width * s) + pad * 2
    const logicalH = Math.ceil(glyph.height * s) + pad * 2

    const oc = new OffscreenCanvas(logicalW * dpr, logicalH * dpr)
    const octx = oc.getContext('2d')
    if (!octx) throw new Error('No 2d context on OffscreenCanvas')

    octx.scale(dpr, dpr)
    octx.fillStyle = isUpper ? COLORS.inkDark : COLORS.ink
    octx.font = `bold ${fontSize}px ${FONT_FAMILY}`
    octx.textBaseline = 'alphabetic'
    octx.textAlign = 'left'

    octx.fillText(glyph.char, -glyph.offsetX * s + pad, -glyph.offsetY * s + pad)

    const texture = Texture.from({
      resource: oc.transferToImageBitmap(),
      resolution: dpr,
    })

    this.textureCache.set(key, texture)
    return texture
  }

  /** Pre-bake a glow texture using Canvas 2D shadow — same technique as the old renderer. */
  private getGlowTexture(glyph: GlyphData, scale: number, color: string): Texture {
    const dpr = window.devicePixelRatio
    const key = `glow_${glyph.char}_${scale}_${dpr}_${color}`
    const cached = this.textureCache.get(key)
    if (cached) return cached

    const fontSize = SCALE * scale
    const s = fontSize / 100
    const blur = 24
    const pad = blur + 4

    const logicalW = Math.ceil(glyph.width * s) + pad * 2
    const logicalH = Math.ceil(glyph.height * s) + pad * 2

    const oc = new OffscreenCanvas(logicalW * dpr, logicalH * dpr)
    const octx = oc.getContext('2d')
    if (!octx) throw new Error('No 2d context on OffscreenCanvas')

    octx.scale(dpr, dpr)
    octx.shadowColor = color
    octx.shadowBlur = blur
    octx.shadowOffsetX = 0
    octx.shadowOffsetY = 0
    octx.fillStyle = color
    octx.globalAlpha = 0.85
    octx.font = `bold ${fontSize}px ${FONT_FAMILY}`
    octx.textBaseline = 'alphabetic'
    octx.textAlign = 'left'
    octx.fillText(glyph.char, -glyph.offsetX * s + pad, -glyph.offsetY * s + pad)

    const texture = Texture.from({
      resource: oc.transferToImageBitmap(),
      resolution: dpr,
    })
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
    const glow = this.glowMap.get(letter)
    if (glow) {
      glow.sprite.removeFromParent()
      glow.sprite.destroy()
      this.glowMap.delete(letter)
    }
  }

  /** Get the sprite for a letter (may be null if not yet created). */
  getSprite(letter: LetterBody): Sprite | undefined {
    return this.spriteMap.get(letter)
  }

  /** Update sprite position/rotation from physics state, with optional glow. */
  updateSprite(letter: LetterBody, highlighted = false, glowColor: string | null = null) {
    const sprite = this.spriteMap.get(letter)
    if (!sprite) return

    sprite.position.set(letter.x * SCALE, letter.y * SCALE)
    sprite.rotation = letter.rotation
    sprite.visible = this.showGlyphs
    sprite.alpha = highlighted ? 0.85 : 1

    // Glow sprite management
    const existing = this.glowMap.get(letter)
    if (glowColor) {
      if (!existing || existing.color !== glowColor) {
        if (existing) {
          existing.sprite.removeFromParent()
          existing.sprite.destroy()
        }
        const tex = this.getGlowTexture(letter.glyph, letter.renderScale, glowColor)
        const glow = new Sprite(tex)
        glow.anchor.set(0.5, 0.5)
        this.glowMap.set(letter, { sprite: glow, color: glowColor })
        const parent = sprite.parent
        if (parent) {
          const idx = parent.getChildIndex(sprite)
          parent.addChildAt(glow, idx)
        }
      }
      const glow = this.glowMap.get(letter)!.sprite
      glow.position.set(letter.x * SCALE, letter.y * SCALE)
      glow.rotation = letter.rotation
      glow.visible = this.showGlyphs
    } else if (existing) {
      existing.sprite.removeFromParent()
      existing.sprite.destroy()
      this.glowMap.delete(letter)
    }
  }

  /** Move a sprite to a specific container layer. */
  moveToLayer(letter: LetterBody, layer: Container) {
    const sprite = this.spriteMap.get(letter)
    if (sprite && sprite.parent !== layer) {
      const glow = this.glowMap.get(letter)
      if (glow) layer.addChild(glow.sprite)
      layer.addChild(sprite)
    }
  }
}

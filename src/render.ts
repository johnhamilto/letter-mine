/** Glyph rendering with PixiJS — texture cache and sprite management. */

import { Sprite, Texture, Graphics, Container } from 'pixi.js'
import { SCALE, COLORS, FONT_FAMILY } from './constants'
import type { GlyphData, LetterBody } from './types'

export class LetterRenderer {
  private textureCache = new Map<string, Texture>()
  private spriteMap = new Map<LetterBody, Sprite>()
  private colliderMap = new Map<LetterBody, Graphics>()
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
    const gfx = this.colliderMap.get(letter)
    if (gfx) {
      gfx.removeFromParent()
      gfx.destroy()
      this.colliderMap.delete(letter)
    }
  }

  /** Get the sprite for a letter (may be null if not yet created). */
  getSprite(letter: LetterBody): Sprite | undefined {
    return this.spriteMap.get(letter)
  }

  /** Update sprite position/rotation from Rapier body state. */
  updateSprite(letter: LetterBody, highlighted = false, glowColor: string | null = null) {
    const sprite = this.spriteMap.get(letter)
    if (!sprite) return

    const pos = letter.body.translation()
    const rot = letter.body.rotation()

    sprite.position.set(pos.x * SCALE, pos.y * SCALE)
    sprite.rotation = rot
    sprite.visible = this.showGlyphs

    // Glow / highlight via tint isn't ideal for colored glow, so we use filters
    // For simplicity, we'll modulate alpha to hint at highlight
    if (highlighted) {
      sprite.alpha = 0.85
    } else if (glowColor) {
      sprite.alpha = 0.9
    } else {
      sprite.alpha = 1
    }

    // Collider debug
    if (this.showColliders) {
      let gfx = this.colliderMap.get(letter)
      if (!gfx) {
        gfx = new Graphics()
        this.colliderMap.set(letter, gfx)
        // Add collider gfx to same parent as sprite
        const parent = sprite.parent
        if (parent) parent.addChild(gfx)
      }
      gfx.clear()
      gfx.position.set(pos.x * SCALE, pos.y * SCALE)
      gfx.rotation = rot

      const numColliders = letter.body.numColliders()
      for (let c = 0; c < numColliders; c++) {
        const collider = letter.body.collider(c)
        const verts = collider.vertices()
        if (verts && verts.length >= 4) {
          gfx.setStrokeStyle({ width: 1.5 / letter.renderScale, color: 0xdc2828, alpha: 0.7 })
          gfx.moveTo(verts[0]! * SCALE, verts[1]! * SCALE)
          for (let i = 2; i < verts.length; i += 2) {
            gfx.lineTo(verts[i]! * SCALE, verts[i + 1]! * SCALE)
          }
          gfx.closePath()
          gfx.stroke()
        }
      }
    } else {
      const gfx = this.colliderMap.get(letter)
      if (gfx) {
        gfx.removeFromParent()
        gfx.destroy()
        this.colliderMap.delete(letter)
      }
    }
  }

  /** Move a sprite to a specific container layer. */
  moveToLayer(letter: LetterBody, layer: Container) {
    const sprite = this.spriteMap.get(letter)
    if (sprite && sprite.parent !== layer) {
      layer.addChild(sprite)
    }
    const gfx = this.colliderMap.get(letter)
    if (gfx && gfx.parent !== layer) {
      layer.addChild(gfx)
    }
  }
}

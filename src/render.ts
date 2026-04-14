/** Glyph rendering with PixiJS — atlas-backed texture cache and sprite management. */

import { Sprite, Texture, Container, Rectangle } from 'pixi.js'
import { SCALE, COLORS, FONT_FAMILY } from './constants'
import type { GlyphData, LetterBody } from './types'

export class LetterRenderer {
  private textureCache = new Map<string, Texture>()
  private spriteMap = new Map<LetterBody, Sprite>()
  private glowMap = new Map<LetterBody, { sprite: Sprite; color: string }>()
  private atlasBuilt = false
  showGlyphs = true
  showColliders = false

  /** Container for basin letters (behind shelf). */
  readonly basinLayer = new Container()
  /** Container for foreground letters (above shelf). */
  readonly foregroundLayer = new Container()
  /** Container for the dragged letter (topmost). */
  readonly dragLayer = new Container()

  /**
   * Bake every glyph into one atlas BaseTexture. Each sprite's Texture references
   * a sub-region of that single source, so Pixi's auto-batcher can flush all
   * letters in one draw call instead of one per character.
   */
  initAtlas(glyphs: Record<string, GlyphData>) {
    if (this.atlasBuilt) return
    const dpr = window.devicePixelRatio
    const pad = 4

    type Cell = {
      char: string
      scale: number
      isUpper: boolean
      glyph: GlyphData
      w: number
      h: number
      x: number
      y: number
    }

    const cells: Cell[] = []
    for (const char of Object.keys(glyphs)) {
      const glyph = glyphs[char]!
      const isUpper = char !== char.toLowerCase()
      const scale = isUpper ? 1.0 : 0.6
      const fontSize = SCALE * scale
      const s = fontSize / 100
      const w = Math.ceil(glyph.width * s) + pad * 2
      const h = Math.ceil(glyph.height * s) + pad * 2
      cells.push({ char, scale, isUpper, glyph, w, h, x: 0, y: 0 })
    }

    const maxRowW = 2048
    let curX = 0
    let curY = 0
    let rowH = 0
    let atlasW = 0
    for (const cell of cells) {
      if (curX + cell.w > maxRowW) {
        curY += rowH
        curX = 0
        rowH = 0
      }
      cell.x = curX
      cell.y = curY
      curX += cell.w
      if (cell.h > rowH) rowH = cell.h
      if (curX > atlasW) atlasW = curX
    }
    const atlasH = curY + rowH

    const oc = new OffscreenCanvas(atlasW * dpr, atlasH * dpr)
    const octx = oc.getContext('2d')
    if (!octx) throw new Error('No 2d context on OffscreenCanvas')
    octx.scale(dpr, dpr)
    octx.textBaseline = 'alphabetic'
    octx.textAlign = 'left'

    for (const cell of cells) {
      const fontSize = SCALE * cell.scale
      const s = fontSize / 100
      octx.font = `bold ${fontSize}px ${FONT_FAMILY}`
      octx.fillStyle = cell.isUpper ? COLORS.inkDark : COLORS.ink
      octx.fillText(
        cell.char,
        cell.x + (-cell.glyph.offsetX * s + pad),
        cell.y + (-cell.glyph.offsetY * s + pad),
      )
    }

    const atlasTex = Texture.from({ resource: oc.transferToImageBitmap(), resolution: dpr })
    const source = atlasTex.source

    for (const cell of cells) {
      const tex = new Texture({
        source,
        frame: new Rectangle(cell.x, cell.y, cell.w, cell.h),
      })
      this.textureCache.set(`${cell.char}_${cell.scale}_${dpr}`, tex)
    }

    this.atlasBuilt = true
  }

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

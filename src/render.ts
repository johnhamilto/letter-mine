/** Glyph rendering with PixiJS — atlas-backed texture cache and sprite management. */

import { Sprite, Texture, Container, Rectangle } from 'pixi.js'
import { SCALE, COLORS, FONT_FAMILY } from './constants'
import type { GlyphData, LetterBody } from './types'

interface SpriteEntry {
  sprite: Sprite
  lastX: number
  lastY: number
  lastRotation: number
  lastAlpha: number
}

function makeLetterLayer(): Container {
  const layer = new Container()
  // We do our own hit testing via physics; skip Pixi's pointer-target crawl.
  layer.interactiveChildren = false
  return layer
}

export class LetterRenderer {
  private textureCache = new Map<string, Texture>()
  private spriteMap = new Map<LetterBody, SpriteEntry>()
  private glowMap = new Map<LetterBody, { sprite: Sprite; color: string }>()
  private atlasBuilt = false
  showGlyphs = true

  /** Container for basin letters (behind shelf). */
  readonly basinLayer = makeLetterLayer()
  /** Container for foreground letters (above shelf). */
  readonly foregroundLayer = makeLetterLayer()
  /** Container for the dragged letter (topmost). */
  readonly dragLayer = makeLetterLayer()

  /**
   * Bake every glyph into one atlas TextureSource. Each sprite's Texture references
   * a sub-region of that single source so Pixi batches every letter into one draw call.
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
    const x = letter.x * SCALE
    const y = letter.y * SCALE
    sprite.position.set(x, y)
    sprite.rotation = letter.rotation
    this.spriteMap.set(letter, {
      sprite,
      lastX: x,
      lastY: y,
      lastRotation: letter.rotation,
      lastAlpha: 1,
    })
    this.basinLayer.addChild(sprite)
    return sprite
  }

  /** Remove the sprite for a destroyed letter. */
  removeSprite(letter: LetterBody) {
    const entry = this.spriteMap.get(letter)
    if (entry) {
      entry.sprite.removeFromParent()
      entry.sprite.destroy()
      this.spriteMap.delete(letter)
    }
    const glow = this.glowMap.get(letter)
    if (glow) {
      glow.sprite.removeFromParent()
      glow.sprite.destroy()
      this.glowMap.delete(letter)
    }
  }

  /**
   * Release ownership of the sprite to the caller (e.g., for a detach animation).
   * Glow is destroyed since it has no independent animation path. Returns null if
   * the letter has no active sprite.
   */
  detachSprite(letter: LetterBody): Sprite | null {
    const entry = this.spriteMap.get(letter)
    if (!entry) return null
    entry.sprite.position.set(letter.x * SCALE, letter.y * SCALE)
    entry.sprite.rotation = letter.rotation
    this.spriteMap.delete(letter)
    const glow = this.glowMap.get(letter)
    if (glow) {
      glow.sprite.removeFromParent()
      glow.sprite.destroy()
      this.glowMap.delete(letter)
    }
    return entry.sprite
  }

  /**
   * Update sprite position/rotation from physics state, with optional glow.
   * Short-circuits Pixi property writes when values are unchanged — settled bodies
   * cost one Map lookup and three equality checks per frame.
   */
  updateSprite(letter: LetterBody, highlighted = false, glowColor: string | null = null) {
    const entry = this.spriteMap.get(letter)
    if (!entry) return
    const sprite = entry.sprite

    const x = letter.x * SCALE
    const y = letter.y * SCALE
    const rotation = letter.rotation
    const alpha = highlighted ? 0.85 : 1

    const moved = x !== entry.lastX || y !== entry.lastY || rotation !== entry.lastRotation
    if (moved) {
      sprite.position.set(x, y)
      sprite.rotation = rotation
      entry.lastX = x
      entry.lastY = y
      entry.lastRotation = rotation
    }
    if (alpha !== entry.lastAlpha) {
      sprite.alpha = alpha
      entry.lastAlpha = alpha
    }
    sprite.visible = this.showGlyphs

    const existing = this.glowMap.get(letter)
    if (glowColor) {
      let entry = existing
      if (!entry || entry.color !== glowColor) {
        if (entry) {
          entry.sprite.removeFromParent()
          entry.sprite.destroy()
        }
        const tex = this.getGlowTexture(letter.glyph, letter.renderScale, glowColor)
        const glow = new Sprite(tex)
        glow.anchor.set(0.5, 0.5)
        entry = { sprite: glow, color: glowColor }
        this.glowMap.set(letter, entry)
        const parent = sprite.parent
        if (parent) {
          const idx = parent.getChildIndex(sprite)
          parent.addChildAt(glow, idx)
        }
      }
      if (moved || !existing) {
        entry.sprite.position.set(x, y)
        entry.sprite.rotation = rotation
      }
      entry.sprite.visible = this.showGlyphs
    } else if (existing) {
      existing.sprite.removeFromParent()
      existing.sprite.destroy()
      this.glowMap.delete(letter)
    }
  }

  /** Move a sprite to a specific container layer. */
  moveToLayer(letter: LetterBody, layer: Container) {
    const entry = this.spriteMap.get(letter)
    if (entry && entry.sprite.parent !== layer) {
      const glow = this.glowMap.get(letter)
      if (glow) layer.addChild(glow.sprite)
      layer.addChild(entry.sprite)
    }
  }
}

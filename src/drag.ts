/**
 * Spring-based mouse drag for physics bodies.
 * Click-to-place on shelf, drag to reorder, pull letters off shelf.
 * Uses AABB hit testing on known positions (no Rapier on main thread).
 */

import type { LetterBody } from './types'
import type { Shelf } from './shelf'
import type { PhysicsProxy } from './physics'
import { SCALE, DRAG, GLYPH_TO_PHYSICS } from './constants'

export class DragController {
  private physics: PhysicsProxy
  private canvas: HTMLCanvasElement
  private letters: LetterBody[]
  private shelf: Shelf
  private onLetterRemoved: (letter: LetterBody) => void
  private onSpawnFromShelf: (char: string, x: number, y: number) => LetterBody | null
  private onLetterReleased: (letter: LetterBody) => void

  private dragging: LetterBody | null = null
  private hovered: LetterBody | null = null
  private localAnchor = { x: 0, y: 0 }
  private mouseTarget = { x: 0, y: 0 }
  private mouseStart = { x: 0, y: 0 }
  private didDrag = false

  constructor(
    canvas: HTMLCanvasElement,
    physics: PhysicsProxy,
    letters: LetterBody[],
    shelf: Shelf,
    onLetterRemoved: (letter: LetterBody) => void,
    onSpawnFromShelf: (char: string, x: number, y: number) => LetterBody | null,
    onLetterReleased: (letter: LetterBody) => void,
  ) {
    this.canvas = canvas
    this.physics = physics
    this.letters = letters
    this.shelf = shelf
    this.onLetterRemoved = onLetterRemoved
    this.onSpawnFromShelf = onSpawnFromShelf
    this.onLetterReleased = onLetterReleased

    canvas.addEventListener('mousedown', this.onMouseDown)
    canvas.addEventListener('mousemove', this.onMouseMove)
    canvas.addEventListener('mouseup', this.onMouseUp)
  }

  private getPhysicsPos(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / SCALE,
      y: (e.clientY - rect.top) / SCALE,
    }
  }

  private findLetterAt(px: number, py: number): LetterBody | null {
    for (let i = this.letters.length - 1; i >= 0; i--) {
      const letter = this.letters[i]!
      const halfW = (letter.glyph.width * GLYPH_TO_PHYSICS * letter.renderScale) / 2
      const halfH = (letter.glyph.height * GLYPH_TO_PHYSICS * letter.renderScale) / 2
      if (
        px >= letter.x - halfW &&
        px <= letter.x + halfW &&
        py >= letter.y - halfH &&
        py <= letter.y + halfH
      ) {
        return letter
      }
    }
    return null
  }

  private onMouseDown = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top

    if (this.shelf.isSubmitButtonAt(screenX, screenY)) {
      this.shelf.onSubmit?.()
      return
    }

    const shelfIdx = this.shelf.letterIndexAt(screenX, screenY)
    if (shelfIdx >= 0) {
      const sl = this.shelf.removeLetter(shelfIdx)
      if (sl) {
        const letter = this.onSpawnFromShelf(sl.char, screenX, screenY)
        if (letter) {
          this.dragging = letter
          this.didDrag = true
          this.mouseTarget.x = screenX / SCALE
          this.mouseTarget.y = screenY / SCALE
          this.mouseStart.x = screenX
          this.mouseStart.y = screenY
          this.localAnchor.x = 0
          this.localAnchor.y = 0
          this.physics.wakeUp(letter.id)
          this.physics.setGravityScale(letter.id, DRAG.gravityScale)
          this.canvas.style.cursor = 'grabbing'
        }
      }
      return
    }

    const pos = this.getPhysicsPos(e)
    const letter = this.findLetterAt(pos.x, pos.y)

    if (letter) {
      this.dragging = letter
      this.hovered = null
      this.didDrag = false
      this.mouseTarget.x = pos.x
      this.mouseTarget.y = pos.y
      this.mouseStart.x = screenX
      this.mouseStart.y = screenY

      const rot = letter.rotation
      const cos = Math.cos(-rot)
      const sin = Math.sin(-rot)
      const dx = pos.x - letter.x
      const dy = pos.y - letter.y
      this.localAnchor.x = dx * cos - dy * sin
      this.localAnchor.y = dx * sin + dy * cos

      this.physics.wakeUp(letter.id)
      this.physics.setGravityScale(letter.id, DRAG.gravityScale)

      this.canvas.style.cursor = 'grabbing'
    }
  }

  private onMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const pos = this.getPhysicsPos(e)

    if (!this.dragging) {
      if (this.shelf.letterIndexAt(screenX, screenY) >= 0) {
        this.hovered = null
        this.canvas.style.cursor = 'grab'
      } else {
        const letter = this.findLetterAt(pos.x, pos.y)
        this.hovered = letter
        this.canvas.style.cursor = letter ? 'grab' : 'default'
      }
      return
    }

    if (!this.didDrag) {
      const dx = screenX - this.mouseStart.x
      const dy = screenY - this.mouseStart.y
      if (dx * dx + dy * dy < DRAG.slop * DRAG.slop) return
      this.didDrag = true
    }

    this.mouseTarget.x = pos.x
    this.mouseTarget.y = pos.y
  }

  private onMouseUp = (e: MouseEvent) => {
    if (!this.dragging) return

    const rect = this.canvas.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const letter = this.dragging

    this.physics.setGravityScale(letter.id, 1.0)

    if (this.shelf.isOverShelf(screenX, screenY) || !this.didDrag) {
      const insertIdx = this.didDrag
        ? this.shelf.nearestSlotIndex(screenX)
        : this.shelf.letters.length
      const placed = this.shelf.insertLetter(insertIdx, letter.char, letter.isUpper)
      if (placed) {
        this.physics.remove(letter.id)
        this.onLetterRemoved(letter)
        this.dragging = null
        this.canvas.style.cursor = 'default'
        return
      }
    }

    this.onLetterReleased(letter)
    this.dragging = null
    this.canvas.style.cursor = 'default'
  }

  getDragging(): LetterBody | null {
    return this.dragging
  }

  getHovered(): LetterBody | null {
    return this.dragging ? null : this.hovered
  }

  applySpringForce() {
    if (!this.dragging) return

    const letter = this.dragging
    const rot = letter.rotation

    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const ax = this.localAnchor.x * cos - this.localAnchor.y * sin
    const ay = this.localAnchor.x * sin + this.localAnchor.y * cos

    const dx = this.mouseTarget.x - (letter.x + ax)
    const dy = this.mouseTarget.y - (letter.y + ay)

    this.physics.setLinvel(letter.id, dx * DRAG.linearResponse, dy * DRAG.linearResponse)

    this.physics.setAngvel(letter.id, (ax * dy - ay * dx) * DRAG.angularResponse)
  }
}

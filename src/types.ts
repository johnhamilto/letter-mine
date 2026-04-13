/** Shared type definitions. */

import type RAPIER_NS from "@dimforge/rapier2d-compat"

export interface GlyphData {
  char: string
  convexParts: number[][]
  width: number
  height: number
  offsetX: number
  offsetY: number
}

export interface LetterBody {
  body: RAPIER_NS.RigidBody
  glyph: GlyphData
  char: string
  isUpper: boolean
  renderScale: number
}

export interface ShelfLetter {
  char: string
  isUpper: boolean
}

export type WordStatus = "none" | "prefix" | "valid"

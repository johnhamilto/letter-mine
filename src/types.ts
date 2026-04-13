/** Shared type definitions. */

import type RAPIER_NS from '@dimforge/rapier2d-compat'

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

export type WordStatus = 'none' | 'prefix' | 'valid'

// ── Economy ──

export interface DictionaryEntry {
  freq: number
  tier: number // 0=legendary, 1=rare, 2=uncommon, 3=common, 4=universal
  root: string
  pos: string[]
  syl: number
  rhyme: string | null
}

export interface ScoreBonus {
  label: string
  multiplier: number
}

export interface ScoreResult {
  word: string
  baseValue: number
  tierMultiplier: number
  bonuses: ScoreBonus[]
  finalInk: number
  isRepeat: boolean
  isNewDiscovery: boolean
  isFirstInFamily: boolean
}

// ── Upgrades & Progression ──

export type UpgradeTrack =
  | 'basinCapacity'
  | 'shelfWidth'
  | 'apprenticeShelfWidth'
  | 'miningQuality'
  | 'autoMiner'
  | 'inkMultiplier'

export type UniqueUpgrade =
  | 'wordCheck'
  | 'basinShake'
  | 'vowelBloom'
  | 'siphon'
  | 'wordGhost'
  | 'apprenticeShelf'
  | 'wordCompass'
  | 'autoDiscovery'

export type MilestoneName =
  | 'apprentice'
  | 'journeyman'
  | 'wordsmith'
  | 'lexicographer'
  | 'publisher'

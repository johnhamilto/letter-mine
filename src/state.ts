/** Game state persistence — save/load to localStorage. */

import type { DetachStyle } from './detach-fx'
import type { MilestoneName, UniqueUpgrade, UpgradeTrack } from './types'
import { MILESTONES, UNIQUE_UPGRADES } from './upgrades'

const STORAGE_KEY = 'letter-mine-save'
const SAVE_INTERVAL_MS = 30_000

export interface Settings {
  /** Auto-miner pauses when basin is >= this fraction of capacity. 1.0 = never pause. */
  autoMinerCapPercent: number
  perfMonitorEnabled: boolean
  muted: boolean
  apprenticeFx: DetachStyle
}

export const DEFAULT_SETTINGS: Settings = {
  autoMinerCapPercent: 0.9,
  perfMonitorEnabled: false,
  muted: false,
  apprenticeFx: 'fade-drift',
}

export interface GameState {
  ink: number
  totalInkEarned: number
  discoveredWords: string[]
  discoveredRoots: string[]
  upgradeLevels: Record<UpgradeTrack, number>
  unlockedUniques: UniqueUpgrade[]
  highestMilestone: MilestoneName | null
  settings: Settings
}

const DEFAULT_UPGRADE_LEVELS: Record<UpgradeTrack, number> = {
  basinCapacity: 0,
  shelfWidth: 0,
  apprenticeShelfWidth: 0,
  apprenticeSpeed: 0,
  miningQuality: 0,
  autoMiner: 0,
  inkMultiplier: 0,
  scribesBalance: 0,
  parallelPresses: 0,
  typeFoundry: 0,
  alchemy: 0,
}

const VALID_CAP_PERCENTS: ReadonlySet<number> = new Set([0.25, 0.5, 0.75, 0.9, 1.0])
const VALID_APPRENTICE_FX: ReadonlySet<DetachStyle> = new Set<DetachStyle>([
  'fade-drift',
  'ink-burst',
])

function isDetachStyle(v: unknown): v is DetachStyle {
  return typeof v === 'string' && VALID_APPRENTICE_FX.has(v as DetachStyle)
}

function parseSettings(v: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS }
  if (typeof v !== 'object' || v === null) return out
  const obj = v as Record<string, unknown>
  if (
    typeof obj.autoMinerCapPercent === 'number' &&
    VALID_CAP_PERCENTS.has(obj.autoMinerCapPercent)
  ) {
    out.autoMinerCapPercent = obj.autoMinerCapPercent
  }
  if (typeof obj.perfMonitorEnabled === 'boolean') out.perfMonitorEnabled = obj.perfMonitorEnabled
  if (typeof obj.muted === 'boolean') out.muted = obj.muted
  if (isDetachStyle(obj.apprenticeFx)) out.apprenticeFx = obj.apprenticeFx
  return out
}

const VALID_UNIQUES: ReadonlySet<string> = new Set(UNIQUE_UPGRADES.map((u) => u.id))
const VALID_MILESTONES: ReadonlySet<string> = new Set(MILESTONES.map((m) => m.name))

function isUniqueUpgrade(id: string): id is UniqueUpgrade {
  return VALID_UNIQUES.has(id)
}

function isMilestoneName(name: string): name is MilestoneName {
  return VALID_MILESTONES.has(name)
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * Load saved state. Permissive: unknown fields are dropped, bad values fall back
 * to defaults, and partial corruption never crashes the game or discards the save.
 */
export function loadState(): GameState | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>

  const upgradeLevels = { ...DEFAULT_UPGRADE_LEVELS }
  const savedLevels =
    typeof obj.upgradeLevels === 'object' && obj.upgradeLevels !== null
      ? (obj.upgradeLevels as Record<string, unknown>)
      : {}
  for (const key of Object.keys(DEFAULT_UPGRADE_LEVELS) as UpgradeTrack[]) {
    const v = savedLevels[key]
    if (typeof v === 'number' && Number.isFinite(v)) upgradeLevels[key] = v
  }

  const rawUniques = asStringArray(obj.unlockedUniques)
  const unlockedUniques = rawUniques.filter(isUniqueUpgrade)

  // Migration: 'alchemy' used to be a unique upgrade; it's now a tiered track.
  // Any player who owned the unique starts at level 1 of the new track.
  if (rawUniques.includes('alchemy') && upgradeLevels.alchemy < 1) {
    upgradeLevels.alchemy = 1
  }

  const highestMilestone =
    typeof obj.highestMilestone === 'string' && isMilestoneName(obj.highestMilestone)
      ? obj.highestMilestone
      : null

  return {
    ink: asNumber(obj.ink, 0),
    totalInkEarned: asNumber(obj.totalInkEarned, 0),
    discoveredWords: asStringArray(obj.discoveredWords),
    discoveredRoots: asStringArray(obj.discoveredRoots),
    upgradeLevels,
    unlockedUniques,
    highestMilestone,
    settings: parseSettings(obj.settings),
  }
}

export function saveState(state: GameState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/** Sets up auto-save on interval and beforeunload. Returns a cleanup function. */
export function startAutoSave(getState: () => GameState): () => void {
  const intervalId = setInterval(() => {
    saveState(getState())
  }, SAVE_INTERVAL_MS)

  const onUnload = () => saveState(getState())
  window.addEventListener('beforeunload', onUnload)

  return () => {
    clearInterval(intervalId)
    window.removeEventListener('beforeunload', onUnload)
  }
}

/** Game state persistence — save/load to localStorage. */

import type { MilestoneName, UniqueUpgrade, UpgradeTrack } from "./types"

const STORAGE_KEY = "letter-mine-save"
const SAVE_INTERVAL_MS = 30_000

export interface GameState {
  ink: number
  totalInkEarned: number
  discoveredWords: string[]
  discoveredRoots: string[]
  streak: number
  submittedWords: string[]
  upgradeLevels: Record<UpgradeTrack, number>
  unlockedUniques: UniqueUpgrade[]
  highestMilestone: MilestoneName | null
}

const DEFAULT_UPGRADE_LEVELS: Record<UpgradeTrack, number> = {
  basinCapacity: 0,
  shelfWidth: 0,
  apprenticeShelfWidth: 0,
  miningQuality: 0,
  autoMiner: 0,
  inkMultiplier: 0,
}

export function defaultState(): GameState {
  return {
    ink: 0,
    totalInkEarned: 0,
    discoveredWords: [],
    discoveredRoots: [],
    streak: 0,
    submittedWords: [],
    upgradeLevels: { ...DEFAULT_UPGRADE_LEVELS },
    unlockedUniques: [],
    highestMilestone: null,
  }
}

export function loadState(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.ink !== "number") return null
    if (!Array.isArray(obj.discoveredWords)) return null

    // Merge saved upgrade levels with defaults (handles new tracks added later)
    const savedLevels =
      typeof obj.upgradeLevels === "object" && obj.upgradeLevels !== null
        ? (obj.upgradeLevels as Record<string, number>)
        : {}
    const upgradeLevels = { ...DEFAULT_UPGRADE_LEVELS }
    for (const key of Object.keys(DEFAULT_UPGRADE_LEVELS) as UpgradeTrack[]) {
      if (typeof savedLevels[key] === "number") {
        upgradeLevels[key] = savedLevels[key]
      }
    }

    return {
      ink: obj.ink,
      totalInkEarned: typeof obj.totalInkEarned === "number" ? obj.totalInkEarned : 0,
      discoveredWords: obj.discoveredWords as string[],
      discoveredRoots: Array.isArray(obj.discoveredRoots) ? obj.discoveredRoots as string[] : [],
      streak: typeof obj.streak === "number" ? obj.streak : 0,
      submittedWords: Array.isArray(obj.submittedWords) ? obj.submittedWords as string[] : [],
      upgradeLevels,
      unlockedUniques: Array.isArray(obj.unlockedUniques) ? obj.unlockedUniques as UniqueUpgrade[] : [],
      highestMilestone: typeof obj.highestMilestone === "string" ? obj.highestMilestone as MilestoneName : null,
    }
  } catch {
    return null
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
  window.addEventListener("beforeunload", onUnload)

  return () => {
    clearInterval(intervalId)
    window.removeEventListener("beforeunload", onUnload)
  }
}

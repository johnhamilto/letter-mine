/** Upgrade definitions — static data and pure lookup functions. */

import type { MilestoneName, UniqueUpgrade, UpgradeTrack } from './types'

// ── Tiered upgrades ──

export interface TieredUpgradeDef {
  track: UpgradeTrack
  name: string
  description: string
  values: readonly number[]
  costs: readonly number[]
  requiredMilestone: MilestoneName
}

export const TIERED_UPGRADES: readonly TieredUpgradeDef[] = [
  {
    track: 'basinCapacity',
    name: 'Basin Capacity',
    description: 'Max letters in the basin',
    values: [50, 75, 100, 150, 200, 300, 500, 1000],
    costs: [300, 800, 2000, 5000, 15000, 40000, 100000],
    requiredMilestone: 'apprentice',
  },
  {
    track: 'shelfWidth',
    name: 'Shelf Width',
    description: 'Max letters on the shelf',
    values: [4, 5, 6, 7, 8, 9, 11, 15, 22, 45],
    costs: [200, 400, 800, 1500, 3000, 6000, 15000, 40000, 150000],
    requiredMilestone: 'apprentice',
  },
  {
    track: 'miningQuality',
    name: 'Mining Quality',
    description: 'Ink earned per letter mined',
    values: [0.1, 0.2, 0.3, 0.4, 0.5], // ink per keystroke
    costs: [1500, 6000, 20000, 80000],
    requiredMilestone: 'journeyman',
  },
  {
    track: 'autoMiner',
    name: 'Auto-Miner',
    description: 'Spawns letters at this rate while idle',
    values: [0, 1, 2, 4, 6, 9], // chars/sec, 0 = not purchased
    costs: [3000, 8000, 25000, 70000, 200000],
    requiredMilestone: 'wordsmith',
  },
  {
    track: 'inkMultiplier',
    name: 'Ink Multiplier',
    description: 'Bonus on all Ink earned',
    values: [0, 0.1, 0.25, 0.5, 0.75, 1.0], // bonus fraction
    costs: [5000, 15000, 50000, 150000, 500000],
    requiredMilestone: 'lexicographer',
  },
  {
    track: 'apprenticeShelfWidth',
    name: 'Apprentice Shelf Width',
    description: 'Max word length for the apprentice shelf',
    values: [4, 5, 6, 7, 8, 9, 11, 15, 22, 45],
    costs: [3000, 6000, 12000, 25000, 50000, 100000, 200000, 400000, 800000],
    requiredMilestone: 'lexicographer',
  },
  {
    track: 'apprenticeSpeed',
    name: 'Apprentice Speed',
    description: 'Seconds per full apprentice cycle',
    values: [8, 6, 4.5, 3, 2, 1], // seconds per complete cycle (no separate cooldown)
    costs: [4000, 10000, 25000, 60000, 150000],
    requiredMilestone: 'lexicographer',
  },
  {
    track: 'scribesBalance',
    name: "Scribe's Balance",
    description: 'Auto-miner spawns more of the letters your basin is running low on',
    values: [0, 0.2, 0.4, 0.6, 0.8, 1.0], // 0 = English freq, 1 = pure scarcity-weighted
    costs: [3000, 8000, 20000, 50000, 120000],
    requiredMilestone: 'lexicographer',
  },
  {
    track: 'parallelPresses',
    name: 'Parallel Presses',
    description: 'Additional apprentices working at once',
    values: [1, 2, 3, 4, 6],
    costs: [300_000, 1_000_000, 3_000_000, 10_000_000],
    requiredMilestone: 'publisher',
  },
] as const

// ── Unique upgrades ──

export interface UniqueUpgradeDef {
  id: UniqueUpgrade
  name: string
  description: string
  cost: number
  requiredMilestone: MilestoneName
}

export const UNIQUE_UPGRADES: readonly UniqueUpgradeDef[] = [
  {
    id: 'basinShake',
    name: 'Basin Shake',
    description: 'Shift+Space to scatter piled letters',
    cost: 1000,
    requiredMilestone: 'apprentice',
  },
  {
    id: 'compositorsPick',
    name: "Compositor's Pick",
    description: 'Shift-click a basin letter to banish it',
    cost: 3000,
    requiredMilestone: 'journeyman',
  },
  {
    id: 'letterCount',
    name: 'Letter Census',
    description: 'Shows how many of each letter are in the basin',
    cost: 3000,
    requiredMilestone: 'journeyman',
  },
  {
    id: 'wordCheck',
    name: 'Word Check',
    description: 'See if your shelf word is valid, blocks invalid submissions',
    cost: 4000,
    requiredMilestone: 'journeyman',
  },
  {
    id: 'siphon',
    name: 'Siphon',
    description: 'Tab to type letters from basin onto shelf',
    cost: 10000,
    requiredMilestone: 'wordsmith',
  },
  {
    id: 'wordGhost',
    name: 'Word Ghost',
    description: 'Basin letters that can extend your shelf into a word glow',
    cost: 15000,
    requiredMilestone: 'wordsmith',
  },
  {
    id: 'alchemy',
    name: 'Alchemy',
    description: 'Every 2s, converts one of your most-common basin letters into a rare letter',
    cost: 12000,
    requiredMilestone: 'wordsmith',
  },
  {
    id: 'apprenticeShelf',
    name: 'Apprentice Shelf',
    description: 'Auto-assembles low-value undiscovered words from the basin',
    cost: 15000,
    requiredMilestone: 'lexicographer',
  },
  {
    id: 'subWordHarvest',
    name: 'Sub-Word Harvest',
    description: 'Submitting a word also scores every dictionary word contained within it',
    cost: 20000,
    requiredMilestone: 'lexicographer',
  },
  {
    id: 'overdrive',
    name: 'Press Overdrive',
    description: 'Doubles the auto-miner rate',
    cost: 500000,
    requiredMilestone: 'publisher',
  },
  {
    id: 'autoDiscovery',
    name: 'Apprentice Specialist',
    description: 'Apprentice targets the highest-value undiscovered words',
    cost: 80000,
    requiredMilestone: 'publisher',
  },
  {
    id: 'imprimatur',
    name: 'Imprimatur',
    description: "Every submit also reveals the word's family",
    cost: 400_000,
    requiredMilestone: 'publisher',
  },
]

// ── Milestones ──

export interface MilestoneDef {
  name: MilestoneName
  displayName: string
  wordsRequired: number
}

export const MILESTONES: readonly MilestoneDef[] = [
  { name: 'apprentice', displayName: 'Apprentice', wordsRequired: 10 },
  { name: 'journeyman', displayName: 'Journeyman', wordsRequired: 50 },
  { name: 'wordsmith', displayName: 'Wordsmith', wordsRequired: 150 },
  { name: 'lexicographer', displayName: 'Lexicographer', wordsRequired: 500 },
  { name: 'publisher', displayName: 'Publisher', wordsRequired: 1500 },
  // Master threshold is the full dictionary size, resolved at runtime via totalWords arg.
  { name: 'master', displayName: 'Master', wordsRequired: Infinity },
]

// ── Lookup functions ──

const TIERED_MAP = new Map<UpgradeTrack, TieredUpgradeDef>(TIERED_UPGRADES.map((u) => [u.track, u]))

const MILESTONE_ORDER: readonly MilestoneName[] = MILESTONES.map((m) => m.name)

export function getTieredDef(track: UpgradeTrack): TieredUpgradeDef | undefined {
  return TIERED_MAP.get(track)
}

export function getUpgradeValue(track: UpgradeTrack, level: number): number {
  const def = TIERED_MAP.get(track)
  if (!def) return 0
  return def.values[Math.min(level, def.values.length - 1)] ?? def.values[0] ?? 0
}

export function getUpgradeCost(track: UpgradeTrack, level: number): number | null {
  const def = TIERED_MAP.get(track)
  if (!def) return null
  // level is current level, cost is for next level
  // level 0 = base value (free), cost[0] is for level 1
  if (level >= def.costs.length) return null // maxed
  return def.costs[level] ?? null
}

export function isMaxLevel(track: UpgradeTrack, level: number): boolean {
  const def = TIERED_MAP.get(track)
  if (!def) return true
  return level >= def.costs.length
}

export function milestoneReached(
  wordsDiscovered: number,
  totalWords?: number,
): MilestoneName | null {
  let highest: MilestoneName | null = null
  for (const m of MILESTONES) {
    const threshold = m.wordsRequired === Infinity ? (totalWords ?? Infinity) : m.wordsRequired
    if (wordsDiscovered >= threshold) highest = m.name
  }
  return highest
}

export function isMilestoneAtLeast(
  current: MilestoneName | null,
  required: MilestoneName,
): boolean {
  if (current === null) return false
  const currentIdx = MILESTONE_ORDER.indexOf(current)
  const requiredIdx = MILESTONE_ORDER.indexOf(required)
  return currentIdx >= requiredIdx
}

export function getMilestoneDef(name: MilestoneName): MilestoneDef | undefined {
  return MILESTONES.find((m) => m.name === name)
}

/** Returns true if any upgrade (tiered or unique) is affordable right now. */
export function hasAffordableUpgrade(
  ink: number,
  milestone: MilestoneName | null,
  upgradeLevels: Record<UpgradeTrack, number>,
  unlockedUniques: Set<UniqueUpgrade>,
): boolean {
  for (const def of TIERED_UPGRADES) {
    if (!isMilestoneAtLeast(milestone, def.requiredMilestone)) continue
    const level = upgradeLevels[def.track]
    if (isMaxLevel(def.track, level)) continue
    const cost = getUpgradeCost(def.track, level)
    if (cost !== null && ink >= cost) return true
  }
  for (const def of UNIQUE_UPGRADES) {
    if (!isMilestoneAtLeast(milestone, def.requiredMilestone)) continue
    if (unlockedUniques.has(def.id)) continue
    if (ink >= def.cost) return true
  }
  return false
}

/** Dictionary screen — Preact component: full-screen overlay browsing discovered words. */

import { render } from 'preact'
import { SCORING } from './constants'
import type { DictionaryEntry } from './types'

const TIER_NAMES = ['Legendary', 'Rare', 'Uncommon', 'Common', 'Universal'] as const
const TIER_COLORS = ['#6B4423', '#8B7355', '#9E8E76', '#2C2416', '#2C2416'] as const

export interface DictionaryScreenProps {
  open: boolean
  discoveredWords: Set<string>
  dictionary: Record<string, DictionaryEntry>
  totalInkEarned: number
  onClose: () => void
}

interface TierStats {
  tier: number
  name: string
  multiplier: number
  color: string
  discovered: string[]
  totalCount: number
}

function computeTierStats(
  dictionary: Record<string, DictionaryEntry>,
  discoveredWords: Set<string>,
): TierStats[] {
  const tiers: TierStats[] = Array.from({ length: 5 }, (_, i) => ({
    tier: i,
    name: TIER_NAMES[i]!,
    multiplier: SCORING.tierMultipliers[i]!,
    color: TIER_COLORS[i]!,
    discovered: [],
    totalCount: 0,
  }))

  for (const [word, entry] of Object.entries(dictionary)) {
    const tier = tiers[entry.tier]
    if (!tier) continue
    tier.totalCount++
    if (discoveredWords.has(word)) {
      tier.discovered.push(word)
    }
  }

  for (const tier of tiers) {
    tier.discovered.sort()
  }

  return tiers
}

function computeStats(
  dictionary: Record<string, DictionaryEntry>,
  discoveredWords: Set<string>,
): { longestWord: string; rarestWord: string; rarestTier: number } {
  let longestWord = ''
  let rarestWord = ''
  let rarestTier = 5

  for (const word of discoveredWords) {
    if (word.length > longestWord.length) {
      longestWord = word
    }
    const entry = dictionary[word]
    if (entry && entry.tier < rarestTier) {
      rarestTier = entry.tier
      rarestWord = word
    } else if (entry && entry.tier === rarestTier && word < rarestWord) {
      rarestWord = word
    }
  }

  return { longestWord, rarestWord, rarestTier }
}

function TierSection({ tier }: { tier: TierStats }) {
  const hasDiscovered = tier.discovered.length > 0
  const undiscoveredCount = tier.totalCount - tier.discovered.length

  return (
    <div class="dict-tier">
      <div class="dict-tier-header" style={{ color: tier.color }}>
        <span class="dict-tier-name">{tier.name}</span>
        <span class="dict-tier-mult">{tier.multiplier}x</span>
        <span class="dict-tier-count">
          {tier.discovered.length} / {tier.totalCount.toLocaleString()}
        </span>
      </div>
      <div class="dict-words">
        {hasDiscovered &&
          tier.discovered.map((word) => (
            <span key={word} class="dict-word">
              {word}
            </span>
          ))}
        {undiscoveredCount > 0 && (
          <span class="dict-undiscovered">
            +{undiscoveredCount.toLocaleString()} undiscovered
          </span>
        )}
      </div>
    </div>
  )
}

function DictionaryOverlay(props: DictionaryScreenProps) {
  const { open, discoveredWords, dictionary, totalInkEarned, onClose } = props

  const totalWords = Object.keys(dictionary).length
  const tiers = computeTierStats(dictionary, discoveredWords)
  const stats = computeStats(dictionary, discoveredWords)

  return (
    <div class={`dict-overlay${open ? ' open' : ''}`} onMouseDown={onClose}>
      <div class="dict-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div class="dict-header">
          <div>
            <h2>Dictionary</h2>
            <div class="dict-subtitle">
              {discoveredWords.size.toLocaleString()} / {totalWords.toLocaleString()} words
              discovered
            </div>
          </div>
          <button class="dict-close" onClick={onClose}>
            X
          </button>
        </div>
        <div class="dict-content">
          {tiers.map((tier) => (
            <TierSection key={tier.tier} tier={tier} />
          ))}

          {discoveredWords.size > 0 && (
            <div class="dict-stats">
              <div class="dict-stats-title">Stats</div>
              <div class="dict-stat-row">
                <span class="dict-stat-label">Total Ink Earned</span>
                <span class="dict-stat-value">
                  {Math.floor(totalInkEarned).toLocaleString()}
                </span>
              </div>
              {stats.longestWord && (
                <div class="dict-stat-row">
                  <span class="dict-stat-label">Longest Word</span>
                  <span class="dict-stat-value">
                    {stats.longestWord} ({stats.longestWord.length} letters)
                  </span>
                </div>
              )}
              {stats.rarestWord && (
                <div class="dict-stat-row">
                  <span class="dict-stat-label">Rarest Discovery</span>
                  <span class="dict-stat-value">
                    {stats.rarestWord} ({TIER_NAMES[stats.rarestTier]})
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Mount API for game.ts ──

const container = document.createElement('div')
container.id = 'dictionary-root'
document.body.appendChild(container)

export function renderDictionaryScreen(props: DictionaryScreenProps) {
  render(<DictionaryOverlay {...props} />, container)
}

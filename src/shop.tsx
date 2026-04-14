/** Upgrade shop — Preact component: button + right-edge drawer. */

import { render } from 'preact'
import {
  TIERED_UPGRADES,
  UNIQUE_UPGRADES,
  MILESTONES,
  getUpgradeCost,
  getUpgradeValue,
  isMaxLevel,
  isMilestoneAtLeast,
  hasAffordableUpgrade,
  type TieredUpgradeDef,
  type UniqueUpgradeDef,
} from './upgrades'
import type { MilestoneName, UniqueUpgrade, UpgradeTrack } from './types'

export interface ShopProps {
  open: boolean
  ink: number
  milestone: MilestoneName | null
  upgradeLevels: Record<UpgradeTrack, number>
  ownedUniques: Set<UniqueUpgrade>
  showButton: boolean
  onOpen: () => void
  onClose: () => void
  onBuyTiered: (track: UpgradeTrack) => void
  onBuyUnique: (id: UniqueUpgrade) => void
}

function TieredRow({
  def,
  unlocked,
  ink,
  level,
  onBuy,
}: {
  def: TieredUpgradeDef
  unlocked: boolean
  ink: number
  level: number
  onBuy: (track: UpgradeTrack) => void
}) {
  const maxed = isMaxLevel(def.track, level)
  const cost = getUpgradeCost(def.track, level)
  const currentVal = getUpgradeValue(def.track, level)
  const nextVal = maxed ? null : getUpgradeValue(def.track, level + 1)
  const canBuy = unlocked && !maxed && cost !== null && ink >= cost

  return (
    <div class="shop-row">
      <div class="shop-row-info">
        <div class="shop-row-name">{def.name}</div>
        <div class="shop-row-desc">{def.description}</div>
      </div>
      <div class="shop-row-right">
        {maxed ? (
          <div class="shop-row-status maxed">
            {currentVal} (MAX)
          </div>
        ) : nextVal !== null && cost !== null ? (
          <>
            <div class="shop-row-values">
              {currentVal} &rarr; {nextVal}
            </div>
            <button
              class={`shop-buy${canBuy ? '' : ' disabled'}`}
              onClick={() => { if (canBuy) onBuy(def.track) }}
            >
              {cost.toLocaleString()} Ink
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}

function UniqueRow({
  def,
  unlocked,
  ink,
  owned,
  onBuy,
}: {
  def: UniqueUpgradeDef
  unlocked: boolean
  ink: number
  owned: boolean
  onBuy: (id: UniqueUpgrade) => void
}) {
  const canBuy = unlocked && !owned && ink >= def.cost

  return (
    <div class="shop-row">
      <div class="shop-row-info">
        <div class="shop-row-name">{def.name}</div>
        <div class="shop-row-desc">{def.description}</div>
      </div>
      <div class="shop-row-right">
        {owned ? (
          <div class="shop-row-status maxed">OWNED</div>
        ) : (
          <button
            class={`shop-buy${canBuy ? '' : ' disabled'}`}
            onClick={() => { if (canBuy) onBuy(def.id) }}
          >
            {def.cost.toLocaleString()} Ink
          </button>
        )}
      </div>
    </div>
  )
}

function ShopDrawer(props: ShopProps) {
  const {
    open,
    ink,
    milestone,
    upgradeLevels,
    ownedUniques,
    showButton,
    onOpen,
    onClose,
    onBuyTiered,
    onBuyUnique,
  } = props

  const hasAvailable = showButton && hasAffordableUpgrade(ink, milestone, upgradeLevels, ownedUniques)

  return (
    <>
      {showButton && (
        <button
          class={`shop-btn${open ? ' shop-open' : ''}${hasAvailable ? ' has-available' : ''}`}
          onClick={() => (open ? onClose() : onOpen())}
        >
          Shop
        </button>
      )}
      <div class={`shop-overlay${open ? ' open' : ''}`}>
        <div class="shop-panel" onMouseDown={(e) => e.stopPropagation()}>
          <div class="shop-header">
            <h2>Upgrades</h2>
            <button class="shop-close" onClick={onClose}>
              X
            </button>
          </div>
          <div class="shop-content">
            <div class="shop-milestone">
              {milestone
                ? `Milestone: ${milestone.charAt(0).toUpperCase() + milestone.slice(1)}`
                : 'Earn 500 Ink to unlock upgrades'}
            </div>
            {MILESTONES.map((ms) => {
              const unlocked = isMilestoneAtLeast(milestone, ms.name)
              const tiered = TIERED_UPGRADES.filter((u) => u.requiredMilestone === ms.name)
              const unique = UNIQUE_UPGRADES.filter((u) => u.requiredMilestone === ms.name)
              if (tiered.length === 0 && unique.length === 0) return null

              return (
                <div key={ms.name} class={`shop-section${unlocked ? '' : ' locked'}`}>
                  <h3>
                    {ms.displayName} ({ms.wordsRequired.toLocaleString()} words)
                    {!unlocked && <span class="shop-lock"> &mdash; locked</span>}
                  </h3>
                  {tiered.map((def) => (
                    <TieredRow
                      key={def.track}
                      def={def}
                      unlocked={unlocked}
                      ink={ink}
                      level={upgradeLevels[def.track]}
                      onBuy={onBuyTiered}
                    />
                  ))}
                  {unique.map((def) => (
                    <UniqueRow
                      key={def.id}
                      def={def}
                      unlocked={unlocked}
                      ink={ink}
                      owned={ownedUniques.has(def.id)}
                      onBuy={onBuyUnique}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Mount API for game.ts ──

const container = document.createElement('div')
container.id = 'shop-root'
document.body.appendChild(container)

export function renderShop(props: ShopProps) {
  render(<ShopDrawer {...props} />, container)
}

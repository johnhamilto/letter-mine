/** Upgrade shop — DOM overlay with real hover states and native scroll. */

import {
  TIERED_UPGRADES,
  UNIQUE_UPGRADES,
  MILESTONES,
  getUpgradeCost,
  getUpgradeValue,
  isMaxLevel,
  isMilestoneAtLeast,
  type TieredUpgradeDef,
  type UniqueUpgradeDef,
} from './upgrades'
import type { MilestoneName, UniqueUpgrade, UpgradeTrack } from './types'

export interface ShopCallbacks {
  getInk: () => number
  getUpgradeLevel: (track: UpgradeTrack) => number
  hasUnique: (id: UniqueUpgrade) => boolean
  getMilestone: () => MilestoneName | null
  onBuyTiered: (track: UpgradeTrack) => void
  onBuyUnique: (id: UniqueUpgrade) => void
  onClose: () => void
}

export class Shop {
  private cb: ShopCallbacks
  private root: HTMLDivElement
  private content: HTMLDivElement

  constructor(cb: ShopCallbacks) {
    this.cb = cb

    // Overlay
    this.root = document.createElement('div')
    this.root.className = 'shop-overlay'
    this.root.style.display = 'none'
    this.root.addEventListener('mousedown', (e) => e.stopPropagation())
    this.root.addEventListener('click', (e) => {
      // Click on backdrop closes shop
      if (e.target === this.root) cb.onClose()
    })

    // Panel
    const panel = document.createElement('div')
    panel.className = 'shop-panel'
    this.root.appendChild(panel)

    // Header
    const header = document.createElement('div')
    header.className = 'shop-header'
    const title = document.createElement('h2')
    title.textContent = 'Upgrades'
    header.appendChild(title)
    const closeBtn = document.createElement('button')
    closeBtn.className = 'shop-close'
    closeBtn.textContent = 'X'
    closeBtn.addEventListener('click', () => cb.onClose())
    header.appendChild(closeBtn)
    panel.appendChild(header)

    // Scrollable content
    this.content = document.createElement('div')
    this.content.className = 'shop-content'
    panel.appendChild(this.content)

    document.body.appendChild(this.root)
  }

  show() {
    this.rebuild()
    this.root.style.display = 'flex'
  }

  hide() {
    this.root.style.display = 'none'
  }

  get visible(): boolean {
    return this.root.style.display !== 'none'
  }

  rebuild() {
    this.content.innerHTML = ''
    const milestone = this.cb.getMilestone()
    const ink = this.cb.getInk()

    // Milestone subtitle
    const sub = document.createElement('div')
    sub.className = 'shop-milestone'
    sub.textContent = milestone
      ? `Milestone: ${milestone.charAt(0).toUpperCase() + milestone.slice(1)}`
      : 'Earn 500 Ink to unlock upgrades'
    this.content.appendChild(sub)

    for (const ms of MILESTONES) {
      const unlocked = isMilestoneAtLeast(milestone, ms.name)
      const tiered = TIERED_UPGRADES.filter((u) => u.requiredMilestone === ms.name)
      const unique = UNIQUE_UPGRADES.filter((u) => u.requiredMilestone === ms.name)
      if (tiered.length === 0 && unique.length === 0) continue

      // Section
      const section = document.createElement('div')
      section.className = `shop-section${unlocked ? '' : ' locked'}`

      const heading = document.createElement('h3')
      heading.textContent = `${ms.displayName} (${ms.totalInkRequired.toLocaleString()} Ink)`
      if (!unlocked) {
        const lock = document.createElement('span')
        lock.className = 'shop-lock'
        lock.textContent = ' — locked'
        heading.appendChild(lock)
      }
      section.appendChild(heading)

      for (const def of tiered) {
        section.appendChild(this.buildTieredRow(def, unlocked, ink))
      }
      for (const def of unique) {
        section.appendChild(this.buildUniqueRow(def, unlocked, ink))
      }

      this.content.appendChild(section)
    }
  }

  private buildTieredRow(def: TieredUpgradeDef, unlocked: boolean, ink: number): HTMLElement {
    const level = this.cb.getUpgradeLevel(def.track)
    const maxed = isMaxLevel(def.track, level)
    const cost = getUpgradeCost(def.track, level)
    const currentVal = getUpgradeValue(def.track, level)
    const nextVal = maxed ? null : getUpgradeValue(def.track, level + 1)
    const canBuy = unlocked && !maxed && cost !== null && ink >= cost

    const row = document.createElement('div')
    row.className = 'shop-row'

    const info = document.createElement('div')
    info.className = 'shop-row-info'
    const name = document.createElement('div')
    name.className = 'shop-row-name'
    name.textContent = def.name
    const desc = document.createElement('div')
    desc.className = 'shop-row-desc'
    desc.textContent = def.description
    info.appendChild(name)
    info.appendChild(desc)
    row.appendChild(info)

    const right = document.createElement('div')
    right.className = 'shop-row-right'

    if (maxed) {
      const status = document.createElement('div')
      status.className = 'shop-row-status maxed'
      status.textContent = `${currentVal} (MAX)`
      right.appendChild(status)
    } else if (nextVal !== null && cost !== null) {
      const values = document.createElement('div')
      values.className = 'shop-row-values'
      values.textContent = `${currentVal} → ${nextVal}`
      right.appendChild(values)

      const btn = document.createElement('button')
      btn.className = `shop-buy${canBuy ? '' : ' disabled'}`
      btn.textContent = `${cost.toLocaleString()} Ink`
      if (canBuy) {
        btn.addEventListener('click', () => {
          this.cb.onBuyTiered(def.track)
          this.rebuild()
        })
      }
      right.appendChild(btn)
    }

    row.appendChild(right)
    return row
  }

  private buildUniqueRow(def: UniqueUpgradeDef, unlocked: boolean, ink: number): HTMLElement {
    const owned = this.cb.hasUnique(def.id)
    const canBuy = unlocked && !owned && ink >= def.cost

    const row = document.createElement('div')
    row.className = 'shop-row'

    const info = document.createElement('div')
    info.className = 'shop-row-info'
    const name = document.createElement('div')
    name.className = 'shop-row-name'
    name.textContent = def.name
    const desc = document.createElement('div')
    desc.className = 'shop-row-desc'
    desc.textContent = def.description
    info.appendChild(name)
    info.appendChild(desc)
    row.appendChild(info)

    const right = document.createElement('div')
    right.className = 'shop-row-right'

    if (owned) {
      const status = document.createElement('div')
      status.className = 'shop-row-status maxed'
      status.textContent = 'OWNED'
      right.appendChild(status)
    } else {
      const btn = document.createElement('button')
      btn.className = `shop-buy${canBuy ? '' : ' disabled'}`
      btn.textContent = `${def.cost.toLocaleString()} Ink`
      if (canBuy) {
        btn.addEventListener('click', () => {
          this.cb.onBuyUnique(def.id)
          this.rebuild()
        })
      }
      right.appendChild(btn)
    }

    row.appendChild(right)
    return row
  }
}

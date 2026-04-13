/** HUD -- economy display: ink counter, discovered count, score flash, milestone flash. */

import { Container, Graphics, Text } from 'pixi.js'
import { COLORS, SCORING } from './constants'
import type { Economy } from './economy'
import { getMilestoneDef, MILESTONES } from './upgrades'
import type { MilestoneName } from './types'

const MILESTONE_FLASH_MS = 4000

export class Hud {
  private economy: Economy
  private milestoneText: string | null = null
  private milestoneTime = 0
  getMilestone: () => MilestoneName | null = () => null

  readonly container = new Container()

  // DOM elements for milestone bar
  private barContainer: HTMLDivElement
  private barFill: HTMLDivElement
  private barLabel: HTMLDivElement
  private barTooltip: HTMLDivElement

  // PixiJS text objects
  private inkText: Text
  private discoveredText: Text
  private scoreFlashText: Text
  private scoreBonusText: Text
  private milestoneContainer: Container
  private milestoneBg: Graphics
  private milestoneLabelText: Text
  private milestoneNameText: Text

  constructor(economy: Economy) {
    this.economy = economy

    // Build DOM milestone bar
    this.barContainer = document.createElement('div')
    this.barContainer.className = 'milestone-bar'

    this.barFill = document.createElement('div')
    this.barFill.className = 'milestone-bar-fill'
    this.barContainer.appendChild(this.barFill)

    this.barLabel = document.createElement('div')
    this.barLabel.className = 'milestone-bar-label'
    this.barContainer.appendChild(this.barLabel)

    this.barTooltip = document.createElement('div')
    this.barTooltip.className = 'milestone-bar-tooltip'
    this.barContainer.appendChild(this.barTooltip)

    document.body.appendChild(this.barContainer)

    // Ink counter
    this.inkText = new Text({
      text: '0 Ink',
      style: {
        fontFamily: 'Playfair Display',
        fontSize: 22,
        fontWeight: 'bold',
        fill: COLORS.ink,
      },
    })
    this.inkText.position.set(20, 14)
    this.container.addChild(this.inkText)

    // Discovered count
    this.discoveredText = new Text({
      text: '0 discovered',
      style: {
        fontFamily: 'Playfair Display',
        fontSize: 16,
        fill: COLORS.muted,
      },
    })
    this.discoveredText.position.set(20, 42)
    this.container.addChild(this.discoveredText)

    // Score flash
    this.scoreFlashText = new Text({
      text: '',
      style: {
        fontFamily: 'Playfair Display',
        fontSize: 28,
        fontWeight: 'bold',
        fill: COLORS.valid,
        align: 'center',
      },
    })
    this.scoreFlashText.anchor.set(0.5, 1)
    this.scoreFlashText.visible = false
    this.container.addChild(this.scoreFlashText)

    this.scoreBonusText = new Text({
      text: '',
      style: {
        fontFamily: 'Playfair Display',
        fontSize: 14,
        fill: COLORS.muted,
        align: 'center',
      },
    })
    this.scoreBonusText.anchor.set(0.5, 1)
    this.scoreBonusText.visible = false
    this.container.addChild(this.scoreBonusText)

    // Milestone flash
    this.milestoneContainer = new Container()
    this.milestoneContainer.visible = false
    this.container.addChild(this.milestoneContainer)

    this.milestoneBg = new Graphics()
    this.milestoneContainer.addChild(this.milestoneBg)

    this.milestoneLabelText = new Text({
      text: 'MILESTONE REACHED',
      style: {
        fontFamily: 'Playfair Display',
        fontSize: 13,
        fill: COLORS.muted,
        align: 'center',
      },
    })
    this.milestoneLabelText.anchor.set(0.5, 0.5)
    this.milestoneContainer.addChild(this.milestoneLabelText)

    this.milestoneNameText = new Text({
      text: '',
      style: {
        fontFamily: 'Playfair Display',
        fontSize: 36,
        fontWeight: 'bold',
        fill: COLORS.ink,
        align: 'center',
      },
    })
    this.milestoneNameText.anchor.set(0.5, 0.5)
    this.milestoneContainer.addChild(this.milestoneNameText)
  }

  showMilestone(name: MilestoneName) {
    const def = getMilestoneDef(name)
    this.milestoneText = def?.displayName ?? name
    this.milestoneTime = performance.now()
  }

  render(screenWidth: number, screenHeight: number) {
    this.renderInkCounter()
    this.renderDiscoveredCount()
    this.updateMilestoneBar()
    this.renderScoreFlash(screenWidth)
    this.renderMilestoneFlash(screenWidth, screenHeight)
  }

  private renderInkCounter() {
    const ink = Math.floor(this.economy.ink)
    this.inkText.text = `${ink} Ink`
  }

  private renderDiscoveredCount() {
    const count = this.economy.discoveredWords.size
    this.discoveredText.text = `${count} discovered`
  }

  private updateMilestoneBar() {
    const current = this.getMilestone()
    const totalInk = this.economy.totalInkEarned

    const currentIdx = current ? MILESTONES.findIndex((m) => m.name === current) : -1
    const nextMs = MILESTONES[currentIdx + 1]

    if (!nextMs) {
      this.barFill.style.width = '100%'
      this.barLabel.textContent = 'All milestones reached'
      this.barTooltip.textContent = `${Math.floor(totalInk).toLocaleString()} total Ink earned`
      return
    }

    const prevThreshold = currentIdx >= 0 ? MILESTONES[currentIdx]!.totalInkRequired : 0
    const range = nextMs.totalInkRequired - prevThreshold
    const progress = Math.min(1, (totalInk - prevThreshold) / range)

    this.barFill.style.width = `${(progress * 100).toFixed(1)}%`
    this.barLabel.textContent = nextMs.displayName
    this.barTooltip.textContent = `${Math.floor(totalInk).toLocaleString()} / ${nextMs.totalInkRequired.toLocaleString()} Ink`
  }

  private renderScoreFlash(screenWidth: number) {
    const score = this.economy.lastScore
    if (!score) {
      this.scoreFlashText.visible = false
      this.scoreBonusText.visible = false
      return
    }

    const elapsed = performance.now() - this.economy.lastScoreTime
    if (elapsed > SCORING.scoreFlashMs) {
      this.scoreFlashText.visible = false
      this.scoreBonusText.visible = false
      return
    }

    const t = elapsed / SCORING.scoreFlashMs
    const alpha = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8
    const yOffset = t * -30

    const centerX = screenWidth / 2
    const baseY = 80 + yOffset

    this.scoreFlashText.visible = true
    this.scoreFlashText.text = `+${score.finalInk} Ink`
    this.scoreFlashText.style.fill = score.isRepeat ? COLORS.muted : COLORS.valid
    this.scoreFlashText.position.set(centerX, baseY)
    this.scoreFlashText.alpha = Math.max(0, alpha)

    if (score.bonuses.length > 0 || score.isRepeat) {
      const tags: string[] = []
      if (score.isRepeat) tags.push('repeat')
      for (const b of score.bonuses) tags.push(b.label)

      this.scoreBonusText.visible = true
      this.scoreBonusText.text = tags.join(' / ')
      this.scoreBonusText.position.set(centerX, baseY + 22)
      this.scoreBonusText.alpha = Math.max(0, alpha)
    } else {
      this.scoreBonusText.visible = false
    }
  }

  private renderMilestoneFlash(screenWidth: number, screenHeight: number) {
    if (!this.milestoneText) {
      this.milestoneContainer.visible = false
      return
    }

    const elapsed = performance.now() - this.milestoneTime
    if (elapsed > MILESTONE_FLASH_MS) {
      this.milestoneText = null
      this.milestoneContainer.visible = false
      return
    }

    const t = elapsed / MILESTONE_FLASH_MS
    let alpha: number
    if (t < 0.15) {
      alpha = t / 0.15
    } else if (t < 0.7) {
      alpha = 1
    } else {
      alpha = 1 - (t - 0.7) / 0.3
    }

    const centerX = screenWidth / 2
    const centerY = screenHeight * 0.25
    const scale = t < 0.15 ? 1 + 0.15 * (1 - t / 0.15) : 1

    this.milestoneContainer.visible = true
    this.milestoneContainer.position.set(centerX, centerY)
    this.milestoneContainer.scale.set(scale)
    this.milestoneContainer.alpha = Math.max(0, alpha)

    const bw = 380
    const bh = 90

    this.milestoneBg.clear()
    this.milestoneBg.roundRect(-bw / 2, -bh / 2, bw, bh, 12)
    this.milestoneBg.fill({ color: 0xf5f0e8, alpha: 0.92 })
    this.milestoneBg.roundRect(-bw / 2, -bh / 2, bw, bh, 12)
    this.milestoneBg.stroke({ color: COLORS.valid, width: 2 })

    this.milestoneLabelText.position.set(0, -20)
    this.milestoneNameText.text = this.milestoneText.toUpperCase()
    this.milestoneNameText.position.set(0, 14)
  }
}

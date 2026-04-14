/** HUD -- economy display: ink counter, discovered count, score flash, milestone flash. */

import { Container, Graphics, Text } from 'pixi.js'
import { COLORS, SCORING } from './constants'
import type { Economy } from './economy'
import { getMilestoneDef, MILESTONES } from './upgrades'
import type { MilestoneName, ScoreBonus, ScoreResult } from './types'

interface FlashState {
  finalInk: number
  bonuses: ScoreBonus[]
  isRepeat: boolean
  startTime: number
  aggregateCount: number
  /** Y offset relative to the normal base-Y for stacking concurrent flashes. */
  stackOffset: number
  mainText: Text
  bonusText: Text
}

const FLASH_STACK_SPACING = 46
const FLASH_STACK_WINDOW_MS = 400

const MILESTONE_FLASH_MS = 4000
const FAMILY_FLASH_MS = 1600
const FAMILY_AGGREGATE_WINDOW_MS = 700
const IMPRIMATUR_FLASH_MS = 5000

export class Hud {
  private economy: Economy
  private milestoneText: string | null = null
  private milestoneTime = 0
  getMilestone: () => MilestoneName | null = () => null
  getTotalWords: () => number = () => 0
  onDictionaryOpen: (() => void) | null = null

  readonly container = new Container()

  // Family-flash state (Imprimatur per-submit toast)
  private familyFlashCount = 0
  private familyFlashTime = 0
  private familyFlashText: Text | null = null

  // Imprimatur sweep banner state (one-shot purchase celebration)
  private imprimaturSweepText: string | null = null
  private imprimaturSweepTime = 0

  // DOM elements for milestone bar
  private barContainer: HTMLDivElement
  private barFill: HTMLDivElement
  private barLabel: HTMLDivElement
  private barTooltip: HTMLDivElement
  private dictButton: HTMLButtonElement

  // DOM HUD elements
  private inkEl: HTMLDivElement

  // PixiJS text objects (animated effects only)
  private flashes: FlashState[] = []
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

    // Dictionary button (DOM overlay matching discovered text position)
    this.dictButton = document.createElement('button')
    this.dictButton.className = 'dict-btn'
    this.dictButton.textContent = '0 discovered'
    this.dictButton.addEventListener('click', () => {
      if (this.onDictionaryOpen) this.onDictionaryOpen()
    })
    document.body.appendChild(this.dictButton)

    // Ink counter (DOM)
    this.inkEl = document.createElement('div')
    this.inkEl.className = 'hud-ink'
    this.inkEl.textContent = '0 Ink'
    document.body.appendChild(this.inkEl)

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

  /**
   * Imprimatur per-submit toast: aggregates if called multiple times within
   * a short window (e.g. player submits + apprentice completes in parallel).
   */
  showFamilyFlash(count: number) {
    const now = performance.now()
    if (this.familyFlashTime > 0 && now - this.familyFlashTime < FAMILY_AGGREGATE_WINDOW_MS) {
      this.familyFlashCount += count
    } else {
      this.familyFlashCount = count
    }
    this.familyFlashTime = now
  }

  /** One-shot celebration banner when Imprimatur is first purchased. */
  showImprimaturSweep(count: number) {
    this.imprimaturSweepText = `IMPRIMATUR: ${count.toLocaleString()} words bound`
    this.imprimaturSweepTime = performance.now()
  }

  render(screenWidth: number, screenHeight: number) {
    this.renderInkCounter()
    this.renderDiscoveredCount()
    this.updateMilestoneBar()
    this.renderScoreFlash(screenWidth)
    this.renderFamilyFlash(screenWidth)
    this.renderMilestoneFlash(screenWidth, screenHeight)
    this.renderImprimaturSweep(screenWidth, screenHeight)
  }

  private renderFamilyFlash(screenWidth: number) {
    if (this.familyFlashTime === 0) return
    const elapsed = performance.now() - this.familyFlashTime
    if (elapsed > FAMILY_FLASH_MS) {
      if (this.familyFlashText) {
        this.familyFlashText.removeFromParent()
        this.familyFlashText.destroy()
        this.familyFlashText = null
      }
      this.familyFlashTime = 0
      return
    }

    if (!this.familyFlashText) {
      this.familyFlashText = new Text({
        text: '',
        style: {
          fontFamily: 'Playfair Display',
          fontSize: 16,
          fontStyle: 'italic',
          fill: COLORS.valid,
          align: 'center',
        },
      })
      this.familyFlashText.anchor.set(0.5, 0)
      this.container.addChild(this.familyFlashText)
    }

    const t = elapsed / FAMILY_FLASH_MS
    const alpha = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8
    this.familyFlashText.text = `+${this.familyFlashCount.toLocaleString()} family`
    this.familyFlashText.alpha = Math.max(0, alpha)
    // Sit well below the score-flash stack so the two don't overlap
    this.familyFlashText.position.set(screenWidth / 2, 130 - t * 10)
  }

  private renderImprimaturSweep(screenWidth: number, screenHeight: number) {
    if (!this.imprimaturSweepText) return
    const elapsed = performance.now() - this.imprimaturSweepTime
    if (elapsed > IMPRIMATUR_FLASH_MS) {
      this.imprimaturSweepText = null
      return
    }
    // Reuse milestone flash UI: it's already centered, styled, and dismissible.
    const t = elapsed / IMPRIMATUR_FLASH_MS
    let alpha: number
    if (t < 0.1) alpha = t / 0.1
    else if (t < 0.8) alpha = 1
    else alpha = 1 - (t - 0.8) / 0.2

    const centerX = screenWidth / 2
    const centerY = screenHeight * 0.25

    this.milestoneContainer.visible = true
    this.milestoneContainer.position.set(centerX, centerY)
    this.milestoneContainer.scale.set(1)
    this.milestoneContainer.alpha = Math.max(0, alpha)

    const bw = 460
    const bh = 90

    this.milestoneBg.clear()
    this.milestoneBg.roundRect(-bw / 2, -bh / 2, bw, bh, 12)
    this.milestoneBg.fill({ color: 0xf5f0e8, alpha: 0.92 })
    this.milestoneBg.roundRect(-bw / 2, -bh / 2, bw, bh, 12)
    this.milestoneBg.stroke({ color: COLORS.valid, width: 2 })

    this.milestoneLabelText.position.set(0, -22)
    this.milestoneLabelText.text = 'FAMILIES BOUND'
    this.milestoneNameText.text = this.imprimaturSweepText
    this.milestoneNameText.style.fontSize = 24
    this.milestoneNameText.position.set(0, 14)
  }

  private renderInkCounter() {
    const ink = Math.floor(this.economy.ink)
    this.inkEl.textContent = `${ink.toLocaleString()} Ink`
  }

  private renderDiscoveredCount() {
    const count = this.economy.discoveredWords.size
    this.dictButton.textContent = `${count.toLocaleString()} discovered`
  }

  private updateMilestoneBar() {
    const current = this.getMilestone()
    const discovered = this.economy.discoveredWords.size

    const currentIdx = current ? MILESTONES.findIndex((m) => m.name === current) : -1
    const nextMs = MILESTONES[currentIdx + 1]

    if (!nextMs) {
      this.barFill.style.width = '100%'
      this.barLabel.textContent = 'All milestones reached'
      this.barTooltip.textContent = `${discovered.toLocaleString()} words discovered`
      return
    }

    const prevThreshold =
      currentIdx >= 0 && Number.isFinite(MILESTONES[currentIdx]!.wordsRequired)
        ? MILESTONES[currentIdx]!.wordsRequired
        : 0
    // Master milestone resolves its threshold at runtime from the full dictionary size.
    const nextThreshold = Number.isFinite(nextMs.wordsRequired)
      ? nextMs.wordsRequired
      : this.getTotalWords() || Infinity
    const range = Math.max(1, nextThreshold - prevThreshold)
    const progress = Math.min(1, (discovered - prevThreshold) / range)

    this.barFill.style.width = `${(progress * 100).toFixed(1)}%`
    this.barLabel.textContent = nextMs.displayName
    this.barTooltip.textContent = Number.isFinite(nextThreshold)
      ? `${discovered.toLocaleString()} / ${nextThreshold.toLocaleString()} words`
      : `${discovered.toLocaleString()} words discovered`
  }

  /** Start a fresh score toast. Callers use this for independent events (main submit, apprentice). */
  showScore(score: ScoreResult) {
    const now = performance.now()
    // Concurrent flashes (spawned within the stack window) stack vertically
    const concurrentCount = this.flashes.filter(
      (f) => now - f.startTime < FLASH_STACK_WINDOW_MS,
    ).length

    const mainText = new Text({
      text: '',
      style: {
        fontFamily: 'Playfair Display',
        fontSize: 28,
        fontWeight: 'bold',
        fill: score.isRepeat ? COLORS.muted : COLORS.valid,
        align: 'center',
      },
    })
    mainText.anchor.set(0.5, 1)
    this.container.addChild(mainText)

    const bonusText = new Text({
      text: '',
      style: {
        fontFamily: 'Playfair Display',
        fontSize: 14,
        fill: COLORS.muted,
        align: 'center',
      },
    })
    bonusText.anchor.set(0.5, 1)
    this.container.addChild(bonusText)

    this.flashes.push({
      finalInk: score.finalInk,
      bonuses: [...score.bonuses],
      isRepeat: score.isRepeat,
      startTime: now,
      aggregateCount: 1,
      stackOffset: concurrentCount * FLASH_STACK_SPACING,
      mainText,
      bonusText,
    })
  }

  /** Merge a score into the most recent active flash. Used for sub-words of the current submission. */
  aggregateLastScore(score: ScoreResult) {
    const latest = this.flashes[this.flashes.length - 1]
    if (!latest) {
      this.showScore(score)
      return
    }
    latest.finalInk += score.finalInk
    latest.aggregateCount++
    latest.startTime = performance.now() // extend the flash so it stays visible
  }

  private renderScoreFlash(screenWidth: number) {
    const now = performance.now()
    const centerX = screenWidth / 2

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i]!
      const elapsed = now - flash.startTime
      if (elapsed > SCORING.scoreFlashMs) {
        flash.mainText.removeFromParent()
        flash.mainText.destroy()
        flash.bonusText.removeFromParent()
        flash.bonusText.destroy()
        this.flashes.splice(i, 1)
        continue
      }

      const t = elapsed / SCORING.scoreFlashMs
      const alpha = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8
      const yOffset = t * -30
      const baseY = 80 + flash.stackOffset + yOffset

      flash.mainText.text = `+${Math.floor(flash.finalInk).toLocaleString()} Ink`
      flash.mainText.position.set(centerX, baseY)
      flash.mainText.alpha = Math.max(0, alpha)

      let subtext = ''
      if (flash.aggregateCount > 1) {
        subtext = `${flash.aggregateCount} words`
      } else if (flash.bonuses.length > 0 || flash.isRepeat) {
        const tags: string[] = []
        if (flash.isRepeat) tags.push('repeat')
        for (const b of flash.bonuses) tags.push(b.label)
        subtext = tags.join(' / ')
      }

      if (subtext) {
        flash.bonusText.text = subtext
        flash.bonusText.position.set(centerX, baseY + 22)
        flash.bonusText.alpha = Math.max(0, alpha)
        flash.bonusText.visible = true
      } else {
        flash.bonusText.visible = false
      }
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

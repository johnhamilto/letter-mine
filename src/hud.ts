/** HUD — economy display: ink counter, discovered count, score flash, milestone flash. */

import { COLORS, FONT_FAMILY, SCORING } from "./constants"
import type { Economy } from "./economy"
import { getMilestoneDef, MILESTONES } from "./upgrades"
import type { MilestoneName } from "./types"

const MILESTONE_FLASH_MS = 4000

export class Hud {
  private economy: Economy
  private milestoneText: string | null = null
  private milestoneTime = 0
  getMilestone: () => MilestoneName | null = () => null

  constructor(economy: Economy) {
    this.economy = economy
  }

  showMilestone(name: MilestoneName) {
    const def = getMilestoneDef(name)
    this.milestoneText = def?.displayName ?? name
    this.milestoneTime = performance.now()
  }

  render(ctx: CanvasRenderingContext2D, screenWidth: number, screenHeight: number) {
    this.renderInkCounter(ctx)
    this.renderDiscoveredCount(ctx)
    this.renderMilestoneBar(ctx)
    this.renderScoreFlash(ctx, screenWidth)
    this.renderMilestoneFlash(ctx, screenWidth, screenHeight)
  }

  private renderInkCounter(ctx: CanvasRenderingContext2D) {
    const ink = Math.floor(this.economy.ink)

    ctx.save()
    ctx.fillStyle = COLORS.ink
    ctx.font = `bold 22px ${FONT_FAMILY}`
    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.fillText(`${ink} Ink`, 20, 36)
    ctx.restore()
  }

  private renderDiscoveredCount(ctx: CanvasRenderingContext2D) {
    const count = this.economy.discoveredWords.size

    ctx.save()
    ctx.fillStyle = COLORS.muted
    ctx.font = `16px ${FONT_FAMILY}`
    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.fillText(`${count} discovered`, 20, 58)
    ctx.restore()
  }

  private renderMilestoneBar(ctx: CanvasRenderingContext2D) {
    const current = this.getMilestone()
    const totalInk = this.economy.totalInkEarned

    // Find the next milestone
    const currentIdx = current
      ? MILESTONES.findIndex((m) => m.name === current)
      : -1
    const nextMs = MILESTONES[currentIdx + 1]

    if (!nextMs) {
      // All milestones reached
      ctx.save()
      ctx.fillStyle = COLORS.valid
      ctx.font = `bold 12px ${FONT_FAMILY}`
      ctx.textAlign = "left"
      ctx.textBaseline = "alphabetic"
      ctx.fillText("All milestones reached", 20, 76)
      ctx.restore()
      return
    }

    const prevThreshold = currentIdx >= 0
      ? MILESTONES[currentIdx]!.totalInkRequired
      : 0
    const range = nextMs.totalInkRequired - prevThreshold
    const progress = Math.min(1, (totalInk - prevThreshold) / range)

    const barX = 20
    const barY = 66
    const barW = 140
    const barH = 10

    ctx.save()

    // Label
    ctx.fillStyle = COLORS.muted
    ctx.font = `11px ${FONT_FAMILY}`
    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.fillText(
      `${nextMs.displayName} — ${Math.floor(totalInk).toLocaleString()} / ${nextMs.totalInkRequired.toLocaleString()}`,
      barX,
      barY - 2,
    )

    // Track
    ctx.fillStyle = "rgba(0, 0, 0, 0.08)"
    ctx.beginPath()
    ctx.roundRect(barX, barY, barW, barH, 3)
    ctx.fill()

    // Fill
    if (progress > 0) {
      ctx.fillStyle = COLORS.valid
      ctx.beginPath()
      ctx.roundRect(barX, barY, Math.max(6, barW * progress), barH, 3)
      ctx.fill()
    }

    ctx.restore()
  }

  private renderScoreFlash(
    ctx: CanvasRenderingContext2D,
    screenWidth: number,
  ) {
    const score = this.economy.lastScore
    if (!score) return

    const elapsed = performance.now() - this.economy.lastScoreTime
    if (elapsed > SCORING.scoreFlashMs) return

    const t = elapsed / SCORING.scoreFlashMs
    const alpha = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8
    const yOffset = t * -30

    ctx.save()
    ctx.globalAlpha = Math.max(0, alpha)

    const centerX = screenWidth / 2
    const baseY = 80 + yOffset

    ctx.fillStyle = score.isRepeat ? COLORS.muted : COLORS.valid
    ctx.font = `bold 28px ${FONT_FAMILY}`
    ctx.textAlign = "center"
    ctx.textBaseline = "alphabetic"
    ctx.fillText(`+${score.finalInk} Ink`, centerX, baseY)

    if (score.bonuses.length > 0 || score.isRepeat) {
      const tags: string[] = []
      if (score.isRepeat) tags.push("repeat")
      for (const b of score.bonuses) tags.push(b.label)

      ctx.fillStyle = COLORS.muted
      ctx.font = `14px ${FONT_FAMILY}`
      ctx.fillText(tags.join(" / "), centerX, baseY + 22)
    }

    ctx.restore()
  }

  private renderMilestoneFlash(
    ctx: CanvasRenderingContext2D,
    screenWidth: number,
    screenHeight: number,
  ) {
    if (!this.milestoneText) return

    const elapsed = performance.now() - this.milestoneTime
    if (elapsed > MILESTONE_FLASH_MS) {
      this.milestoneText = null
      return
    }

    const t = elapsed / MILESTONE_FLASH_MS
    // Fade in first 15%, hold, fade out last 30%
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

    // Scale punch: starts at 1.15, settles to 1.0
    const scale = t < 0.15 ? 1 + 0.15 * (1 - t / 0.15) : 1

    ctx.save()
    ctx.globalAlpha = Math.max(0, alpha)
    ctx.translate(centerX, centerY)
    ctx.scale(scale, scale)

    // Full-width dimmed backdrop
    const bw = 380
    const bh = 90
    ctx.fillStyle = "rgba(245, 240, 232, 0.92)"
    ctx.beginPath()
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 12)
    ctx.fill()
    ctx.strokeStyle = COLORS.valid
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 12)
    ctx.stroke()

    // "Milestone Reached" label
    ctx.fillStyle = COLORS.muted
    ctx.font = `13px ${FONT_FAMILY}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("MILESTONE REACHED", 0, -20)

    // Milestone name
    ctx.fillStyle = COLORS.ink
    ctx.font = `bold 36px ${FONT_FAMILY}`
    ctx.fillText(this.milestoneText.toUpperCase(), 0, 14)

    ctx.restore()
  }
}

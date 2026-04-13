/** HUD — economy display: ink counter, discovered count, score flash, milestone flash. */

import { COLORS, FONT_FAMILY, SCORING } from "./constants"
import type { Economy } from "./economy"
import { getMilestoneDef } from "./upgrades"
import type { MilestoneName } from "./types"

const MILESTONE_FLASH_MS = 3000

export class Hud {
  private economy: Economy
  private milestoneText: string | null = null
  private milestoneTime = 0

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

    ctx.save()
    ctx.globalAlpha = Math.max(0, alpha)

    // Subtle backdrop
    ctx.fillStyle = "rgba(245, 240, 232, 0.85)"
    const bw = 320
    const bh = 70
    ctx.beginPath()
    ctx.roundRect(centerX - bw / 2, centerY - bh / 2, bw, bh, 8)
    ctx.fill()

    // Title
    ctx.fillStyle = COLORS.ink
    ctx.font = `bold 32px ${FONT_FAMILY}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(this.milestoneText.toUpperCase(), centerX, centerY)

    ctx.restore()
  }
}

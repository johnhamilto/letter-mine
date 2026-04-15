import { Graphics, type Sprite } from 'pixi.js'
import { COLORS } from './constants'

export type DetachStyle = 'fade-drift' | 'ink-burst'

const FADE_DRIFT_MS = 260
const FADE_DRIFT_RISE = 6
const FADE_DRIFT_END_SCALE = 0.7

const BURST_MS = 440
const BURST_PARTICLE_COUNT = 7
const BURST_SPEED_MIN = 40
const BURST_SPEED_MAX = 110
const BURST_UPWARD_BIAS = 30
const BURST_GRAVITY = 260
const BURST_RADIUS = 2.2
const BURST_LETTER_FADE_PORTION = 0.35

interface FadeDriftActive {
  kind: 'fade-drift'
  sprite: Sprite
  start: number
  duration: number
  startY: number
  startScale: number
}

interface BurstParticle {
  gfx: Graphics
  startX: number
  startY: number
  vx: number
  vy: number
}

interface InkBurstActive {
  kind: 'ink-burst'
  sprite: Sprite
  particles: BurstParticle[]
  start: number
  duration: number
  startScale: number
}

type Active = FadeDriftActive | InkBurstActive

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function parseHexColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

export class DetachFx {
  private active: Active[] = []

  spawn(sprite: Sprite, style: DetachStyle = 'fade-drift') {
    const start = performance.now()
    if (style === 'fade-drift') {
      this.active.push({
        kind: 'fade-drift',
        sprite,
        start,
        duration: FADE_DRIFT_MS,
        startY: sprite.y,
        startScale: sprite.scale.x,
      })
      return
    }

    const parent = sprite.parent
    const particles: BurstParticle[] = []
    if (parent) {
      const startX = sprite.x
      const startY = sprite.y
      const inkColor = parseHexColor(COLORS.ink)
      for (let i = 0; i < BURST_PARTICLE_COUNT; i++) {
        const angle = (Math.PI * 2 * i) / BURST_PARTICLE_COUNT + (Math.random() - 0.5) * 0.6
        const speed = BURST_SPEED_MIN + Math.random() * (BURST_SPEED_MAX - BURST_SPEED_MIN)
        const radius = BURST_RADIUS * (0.7 + Math.random() * 0.6)
        const gfx = new Graphics()
        gfx.circle(0, 0, radius).fill(inkColor)
        gfx.position.set(startX, startY)
        parent.addChild(gfx)
        particles.push({
          gfx,
          startX,
          startY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - BURST_UPWARD_BIAS,
        })
      }
    }
    this.active.push({
      kind: 'ink-burst',
      sprite,
      particles,
      start,
      duration: BURST_MS,
      startScale: sprite.scale.x,
    })
  }

  update() {
    const now = performance.now()
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i]
      if (!a) continue
      const elapsed = now - a.start
      const t = Math.min(1, elapsed / a.duration)
      const eased = easeOutCubic(t)

      if (a.kind === 'fade-drift') {
        a.sprite.alpha = 1 - eased
        a.sprite.y = a.startY - FADE_DRIFT_RISE * eased
        const s = a.startScale * (1 - (1 - FADE_DRIFT_END_SCALE) * eased)
        a.sprite.scale.set(s)
      } else {
        const letterT = Math.min(1, t / BURST_LETTER_FADE_PORTION)
        const letterEased = easeOutCubic(letterT)
        a.sprite.alpha = 1 - letterEased
        a.sprite.scale.set(a.startScale * (1 - 0.2 * letterEased))

        const dt = elapsed / 1000
        for (const p of a.particles) {
          p.gfx.x = p.startX + p.vx * dt
          p.gfx.y = p.startY + p.vy * dt + 0.5 * BURST_GRAVITY * dt * dt
          p.gfx.alpha = 1 - eased
        }
      }

      if (t >= 1) this.finish(i)
    }
  }

  destroy() {
    for (let i = this.active.length - 1; i >= 0; i--) this.finish(i)
  }

  private finish(i: number) {
    const a = this.active[i]
    if (!a) return
    a.sprite.removeFromParent()
    a.sprite.destroy()
    if (a.kind === 'ink-burst') {
      for (const p of a.particles) {
        p.gfx.removeFromParent()
        p.gfx.destroy()
      }
    }
    this.active.splice(i, 1)
  }
}

import type RAPIER_NS from "@dimforge/rapier2d-compat"
import { createLetterBody } from "./physics"
import { MiningPrompt } from "./mining"
import { DragController } from "./drag"
import { Shelf } from "./shelf"
import { LetterRenderer } from "./render"
import { Economy } from "./economy"
import { Hud } from "./hud"
import { loadState, startAutoSave, type GameState } from "./state"
import {
  getUpgradeValue,
  getUpgradeCost,
  milestoneReached,
  UNIQUE_UPGRADES,
} from "./upgrades"
import { Shop } from "./shop"
import { saveState } from "./state"
import { createDebugUI } from "./debug"
import { MINING_WORDS } from "./data/words"
import {
  SCALE,
  COLORS,
  PHYSICS,
  FIXED_DT,
  MAX_SUBSTEPS,
  FOREGROUND_MS,
  BASIN,
  FONT_FAMILY,
} from "./constants"
import type {
  GlyphData,
  LetterBody,
  DictionaryEntry,
  MilestoneName,
  UpgradeTrack,
  UniqueUpgrade,
} from "./types"

export class Game {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  RAPIER: typeof RAPIER_NS
  glyphs: Record<string, GlyphData>
  world: RAPIER_NS.World
  letters: LetterBody[] = []
  width = 0
  height = 0
  wallBodies: RAPIER_NS.RigidBody[] = []
  floorBody: RAPIER_NS.RigidBody | null = null

  // Basin overflow state
  overflowCountdown = 0 // seconds remaining, 0 = not overflowing
  isDraining = false // floor removed, letters falling out
  mining: MiningPrompt
  drag: DragController
  shelf!: Shelf
  renderer: LetterRenderer
  economy: Economy
  hud: Hud
  dictionary: Record<string, DictionaryEntry> = {}
  foregroundLetters = new Map<LetterBody, number>()

  // Upgrade & progression state
  upgradeLevels: Record<UpgradeTrack, number> = {
    basinCapacity: 0, shelfWidth: 0, apprenticeShelfWidth: 0,
    miningQuality: 0, autoMiner: 0, inkMultiplier: 0,
  }
  unlockedUniques: Set<UniqueUpgrade> = new Set()
  highestMilestone: MilestoneName | null = null
  shopOpen = false
  shop: Shop
  shopBtn: HTMLButtonElement

  private spawnQueue: Array<{ char: string; x: number; y: number }> = []

  constructor(
    canvas: HTMLCanvasElement,
    RAPIER: typeof RAPIER_NS,
    glyphs: Record<string, GlyphData>,
  ) {
    this.canvas = canvas
    this.RAPIER = RAPIER
    this.glyphs = glyphs

    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("No 2d context")
    this.ctx = ctx

    // Physics world
    this.world = new RAPIER.World(new RAPIER.Vector2(0, PHYSICS.gravity))
    const ip = this.world.integrationParameters
    ip.numSolverIterations = PHYSICS.solverIterations
    ip.numInternalPgsIterations = PHYSICS.pgsIterations
    ip.contact_natural_frequency = PHYSICS.contactFrequency
    ip.normalizedPredictionDistance = PHYSICS.predictionDistance
    ip.normalizedAllowedLinearError = PHYSICS.allowedLinearError
    ip.maxCcdSubsteps = PHYSICS.maxCcdSubsteps

    // Renderer
    this.renderer = new LetterRenderer()

    // Economy — hydrate from saved state if available
    this.economy = new Economy()
    const saved = loadState()
    if (saved) {
      this.economy.fromState(saved)
      this.upgradeLevels = { ...saved.upgradeLevels }
      this.unlockedUniques = new Set(saved.unlockedUniques)
      this.highestMilestone = saved.highestMilestone
    }
    this.hud = new Hud(this.economy)
    this.hud.getMilestone = () => this.highestMilestone
    // Check milestones on load (may have earned ink before milestones existed)
    // Suppress the flash on boot — just update the milestone level
    const reached = milestoneReached(this.economy.totalInkEarned)
    if (reached) this.highestMilestone = reached

    // Shelf — width from upgrade level
    const shelfSlots = getUpgradeValue("shelfWidth", this.upgradeLevels.shelfWidth)
    this.shelf = new Shelf(shelfSlots)
    this.shelf.onSubmit = () => this.submitShelf()
    if (saved) {
      this.shelf.submittedWords = saved.submittedWords
    }

    // Shop
    this.shop = new Shop({
      getInk: () => this.economy.ink,
      getUpgradeLevel: (track) => this.upgradeLevels[track],
      hasUnique: (id) => this.unlockedUniques.has(id),
      getMilestone: () => this.highestMilestone,
      onBuyTiered: (track) => this.buyTieredUpgrade(track),
      onBuyUnique: (id) => this.buyUniqueUpgrade(id),
      onClose: () => this.closeShop(),
    })

    this.resize()
    window.addEventListener("resize", () => this.resize())

    // Debug UI
    createDebugUI({
      onToggleGlyphs: () => {
        this.renderer.showGlyphs = !this.renderer.showGlyphs
        return this.renderer.showGlyphs
      },
      onToggleColliders: () => {
        this.renderer.showColliders = !this.renderer.showColliders
        return this.renderer.showColliders
      },
      onSpawn100: () => {
        const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
        for (let i = 0; i < 100; i++) {
          const char = chars[Math.floor(Math.random() * chars.length)]!
          const x = Math.random() * this.width * 0.8 + this.width * 0.1
          const y = Math.random() * this.height * 0.3
          this.spawnLetter(char, x, y)
        }
      },
    })

    // Mining prompt
    this.mining = new MiningPrompt({
      words: MINING_WORDS,
      onLetterMined: (char, screenX, screenY) => {
        this.spawnLetter(char, screenX, screenY)
        this.economy.creditLetterMined()
      },
    })

    // Drag controller
    this.drag = new DragController(
      canvas,
      RAPIER,
      this.world,
      this.letters,
      this.shelf,
      (letter) => {
        const idx = this.letters.indexOf(letter)
        if (idx >= 0) this.letters.splice(idx, 1)
        this.foregroundLetters.delete(letter)
      },
      (char, screenX, screenY) => {
        const glyph = this.glyphs[char]
        if (!glyph) return null
        const letter = createLetterBody(
          this.RAPIER,
          this.world,
          glyph,
          screenX / SCALE,
          screenY / SCALE,
        )
        if (letter) this.letters.push(letter)
        return letter
      },
      (letter) => {
        this.foregroundLetters.set(letter, performance.now())
      },
    )

    // Keyboard
    window.addEventListener("keydown", (e) => {
      // Shop toggle
      if (e.key === "Escape" && this.shopOpen) {
        this.closeShop()
        return
      }

      // Block game input when shop is open
      if (this.shopOpen) return

      if (e.key === "Enter") {
        this.submitShelf()
      } else if (e.key === "Escape") {
        this.dumpShelfLetters()
      }
    })

    // DOM shop button
    this.shopBtn = document.createElement("button")
    this.shopBtn.className = "shop-btn"
    this.shopBtn.textContent = "Shop"
    this.shopBtn.addEventListener("click", () => this.openShop())
    if (this.shelf.submittedWords.length > 0) this.shopBtn.style.display = "block"
    document.body.appendChild(this.shopBtn)

    this.loadDictionary()

    // Auto-save every 30s + on page unload
    startAutoSave(() => this.buildSaveState())
  }

  resize() {
    const dpr = window.devicePixelRatio
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.canvas.width = this.width * dpr
    this.canvas.height = this.height * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    this.buildWalls()
    this.shelf.rebuild(this.width, this.height)
  }

  buildWalls() {
    const R = this.RAPIER
    for (const body of this.wallBodies) {
      this.world.removeRigidBody(body)
    }
    this.wallBodies = []
    this.floorBody = null

    const w = this.width / SCALE
    const h = this.height / SCALE

    // Floor (tracked separately for drain mechanic)
    if (!this.isDraining) {
      const floor = this.world.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(0, h),
      )
      this.world.createCollider(
        R.ColliderDesc.halfspace(new R.Vector2(0, -1)),
        floor,
      )
      this.wallBodies.push(floor)
      this.floorBody = floor
    }

    // Ceiling, left, right
    const sides: Array<{ x: number; y: number; nx: number; ny: number }> = [
      { x: 0, y: 0, nx: 0, ny: 1 },
      { x: 0, y: 0, nx: 1, ny: 0 },
      { x: w, y: 0, nx: -1, ny: 0 },
    ]

    for (const wall of sides) {
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(wall.x, wall.y),
      )
      this.world.createCollider(
        R.ColliderDesc.halfspace(new R.Vector2(wall.nx, wall.ny)),
        body,
      )
      this.wallBodies.push(body)
    }
  }

  removeFloor() {
    if (this.floorBody) {
      this.world.removeRigidBody(this.floorBody)
      const idx = this.wallBodies.indexOf(this.floorBody)
      if (idx >= 0) this.wallBodies.splice(idx, 1)
      this.floorBody = null
    }
  }

  restoreFloor() {
    if (this.floorBody) return
    const R = this.RAPIER
    const h = this.height / SCALE
    const floor = this.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(0, h),
    )
    this.world.createCollider(
      R.ColliderDesc.halfspace(new R.Vector2(0, -1)),
      floor,
    )
    this.wallBodies.push(floor)
    this.floorBody = floor
  }

  async loadDictionary() {
    try {
      const resp = await fetch(`${import.meta.env.BASE_URL}dictionary.json`)
      const data = (await resp.json()) as Record<string, DictionaryEntry>
      this.dictionary = data
      const words = new Set(Object.keys(data))
      this.shelf.loadDictionary(words)
      this.shelf.discoveredWords = this.economy.discoveredWords
      console.log(`Dictionary loaded: ${words.size} words`)
    } catch {
      console.warn("Dictionary not found — shelf validation disabled")
    }
  }

  // ── Progression ──

  buildSaveState(): GameState {
    return {
      ...this.economy.toPartialState(this.shelf.submittedWords),
      upgradeLevels: { ...this.upgradeLevels },
      unlockedUniques: [...this.unlockedUniques],
      highestMilestone: this.highestMilestone,
    }
  }

  checkMilestones() {
    const reached = milestoneReached(this.economy.totalInkEarned)
    if (reached && reached !== this.highestMilestone) {
      this.highestMilestone = reached
      this.hud.showMilestone(reached)
      this.shopBtn.style.display = "block"
    }
  }

  openShop() {
    this.shopOpen = true
    this.mining.paused = true
    this.shop.show()
  }

  closeShop() {
    this.shopOpen = false
    this.mining.paused = false
    this.shop.hide()
  }

  getBasinCapacity(): number {
    return getUpgradeValue("basinCapacity", this.upgradeLevels.basinCapacity)
  }

  buyTieredUpgrade(track: UpgradeTrack) {
    const level = this.upgradeLevels[track]
    const cost = getUpgradeCost(track, level)
    if (cost === null) return
    if (!this.economy.spendInk(cost)) return
    this.upgradeLevels[track] = level + 1
    this.applyUpgrade(track)
    saveState(this.buildSaveState())
  }

  buyUniqueUpgrade(id: UniqueUpgrade) {
    if (this.unlockedUniques.has(id)) return
    const def = UNIQUE_UPGRADES.find((u) => u.id === id)
    if (!def) return
    if (!this.economy.spendInk(def.cost)) return
    this.unlockedUniques.add(id)
    saveState(this.buildSaveState())
  }

  applyUpgrade(track: UpgradeTrack) {
    const value = getUpgradeValue(track, this.upgradeLevels[track])
    switch (track) {
      case "basinCapacity":
        // Overflow uses getBasinCapacity() — auto-updates
        break
      case "shelfWidth":
        this.shelf.maxSlots = value
        break
    }
  }

  submitShelf() {
    if (this.shelf.letters.length === 0) return
    const result = this.shelf.submit()
    if (result.valid) {
      const normalized = result.word.toLowerCase()
      const entry = this.dictionary[normalized]
      const score = this.economy.scoreWord(
        result.word,
        result.submittedLetters,
        entry,
      )
      console.log(
        `Submitted: ${result.word} → +${score.finalInk} Ink`,
        score.bonuses.map((b) => b.label).join(", "),
      )
      this.checkMilestones()
      this.shopBtn.style.display = "block"
    } else {
      this.economy.resetStreak()
      this.dumpShelfLetters(result.letters)
    }
  }

  dumpShelfLetters(letters?: Array<{ char: string }>) {
    // If called directly (Escape), grab current shelf letters and clear
    if (!letters) {
      letters = [...this.shelf.letters]
      // Positions must be read before clear()
    }
    if (letters.length === 0) return
    const positions = letters.map((_, i) => this.shelf.slotPosition(i))
    this.shelf.clear()
    const now = performance.now()
    for (let i = 0; i < letters.length; i++) {
      this.spawnLetter(letters[i]!.char, positions[i]!.x, positions[i]!.y)
    }
    this.pendingForeground = now
  }

  // Timestamp for marking newly spawned letters as foreground after flush
  private pendingForeground = 0

  /** Queue a letter to spawn. Safe to call from any context. */
  spawnLetter(char: string, x: number, y: number) {
    this.spawnQueue.push({ char, x, y })
  }

  private flushSpawnQueue() {
    const markForeground = this.pendingForeground > 0
    for (const s of this.spawnQueue) {
      const glyph = this.glyphs[s.char]
      if (!glyph) continue
      const letter = createLetterBody(
        this.RAPIER,
        this.world,
        glyph,
        s.x / SCALE,
        s.y / SCALE,
      )
      if (letter) {
        this.letters.push(letter)
        if (markForeground) {
          this.foregroundLetters.set(letter, this.pendingForeground)
        }
      }
    }
    this.spawnQueue.length = 0
    this.pendingForeground = 0
  }

  // ── Basin overflow ──

  updateOverflow(dt: number) {
    const count = this.letters.length
    const max = this.getBasinCapacity()

    if (this.isDraining) {
      // Wait until all letters are gone, then restore
      if (count === 0) {
        this.isDraining = false
        this.overflowCountdown = 0
        this.restoreFloor()
      }
      return
    }

    if (count > max) {
      if (this.overflowCountdown <= 0) {
        this.overflowCountdown = BASIN.countdownSec
      }
      this.overflowCountdown -= dt
      if (this.overflowCountdown <= 0) {
        // Drain!
        this.isDraining = true
        this.overflowCountdown = 0
        this.removeFloor()
        // Also dump shelf letters
        this.dumpShelfLetters()
      }
    } else {
      // Back under capacity — reset countdown
      this.overflowCountdown = 0
    }
  }

  killOffscreen() {
    const killY = (this.height + BASIN.killPlaneOffset) / SCALE
    for (let i = this.letters.length - 1; i >= 0; i--) {
      const letter = this.letters[i]!
      const pos = letter.body.translation()
      if (pos.y > killY) {
        this.world.removeRigidBody(letter.body)
        this.foregroundLetters.delete(letter)
        this.letters.splice(i, 1)
      }
    }
  }

  renderOverflowVignette(ctx: CanvasRenderingContext2D) {
    const count = this.letters.length
    const max = this.getBasinCapacity()
    const warnAt = Math.floor(max * BASIN.warnRatio)

    if (count < warnAt && !this.isDraining) return

    // Intensity ramps from 0 at warnAt to 1 at max, stays 1 past max
    let intensity = Math.min(1, (count - warnAt) / (max - warnAt))

    // Pulsate when countdown is active
    if (this.overflowCountdown > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150)
      intensity = Math.max(intensity, 0.6 + 0.4 * pulse)
    } else if (this.isDraining) {
      intensity = 1
    }

    if (intensity <= 0) return

    const alpha = intensity * 0.35
    const spread = 60 + intensity * 80

    ctx.save()

    // Top edge
    const topGrad = ctx.createLinearGradient(0, 0, 0, spread)
    topGrad.addColorStop(0, `rgba(192, 57, 43, ${alpha})`)
    topGrad.addColorStop(1, "rgba(192, 57, 43, 0)")
    ctx.fillStyle = topGrad
    ctx.fillRect(0, 0, this.width, spread)

    // Bottom edge
    const botGrad = ctx.createLinearGradient(0, this.height, 0, this.height - spread)
    botGrad.addColorStop(0, `rgba(192, 57, 43, ${alpha})`)
    botGrad.addColorStop(1, "rgba(192, 57, 43, 0)")
    ctx.fillStyle = botGrad
    ctx.fillRect(0, this.height - spread, this.width, spread)

    // Left edge
    const leftGrad = ctx.createLinearGradient(0, 0, spread, 0)
    leftGrad.addColorStop(0, `rgba(192, 57, 43, ${alpha * 0.6})`)
    leftGrad.addColorStop(1, "rgba(192, 57, 43, 0)")
    ctx.fillStyle = leftGrad
    ctx.fillRect(0, 0, spread, this.height)

    // Right edge
    const rightGrad = ctx.createLinearGradient(this.width, 0, this.width - spread, 0)
    rightGrad.addColorStop(0, `rgba(192, 57, 43, ${alpha * 0.6})`)
    rightGrad.addColorStop(1, "rgba(192, 57, 43, 0)")
    ctx.fillStyle = rightGrad
    ctx.fillRect(this.width - spread, 0, spread, this.height)

    ctx.restore()
  }

  renderOverflowHUD(ctx: CanvasRenderingContext2D) {
    const count = this.letters.length
    const max = this.getBasinCapacity()
    const warnAt = Math.floor(max * BASIN.warnRatio)

    if (count < warnAt && !this.isDraining) return

    const isOver = count > max
    const hasMessage = this.overflowCountdown > 0 || this.isDraining
    const boxWidth = 240
    const boxHeight = hasMessage ? 64 : 36
    const bx = (this.width - boxWidth) / 2
    const shelfTop = this.shelf.rect.y
    const by = shelfTop - boxHeight - 12

    // Container
    ctx.fillStyle = COLORS.bg
    ctx.beginPath()
    ctx.roundRect(bx, by, boxWidth, boxHeight, 8)
    ctx.fill()
    ctx.strokeStyle = isOver ? COLORS.error : COLORS.shelf
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(bx, by, boxWidth, boxHeight, 8)
    ctx.stroke()

    // Capacity bar
    const barPad = 16
    const barWidth = boxWidth - barPad * 2
    const barHeight = 14
    const barX = bx + barPad
    const barY = by + boxHeight - barHeight - 10

    ctx.fillStyle = "rgba(0, 0, 0, 0.08)"
    ctx.beginPath()
    ctx.roundRect(barX, barY, barWidth, barHeight, 4)
    ctx.fill()

    const ratio = Math.min(1, count / max)
    ctx.fillStyle = isOver ? COLORS.error : COLORS.valid
    ctx.beginPath()
    ctx.roundRect(barX, barY, barWidth * ratio, barHeight, 4)
    ctx.fill()

    ctx.fillStyle = COLORS.ink
    ctx.font = `bold 11px ${FONT_FAMILY}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(`${count} / ${max}`, barX + barWidth / 2, barY + barHeight / 2)

    // Warning / countdown message
    if (this.overflowCountdown > 0) {
      ctx.fillStyle = COLORS.error
      ctx.font = `bold 18px ${FONT_FAMILY}`
      ctx.textAlign = "center"
      ctx.textBaseline = "alphabetic"
      ctx.fillText(
        `OVERFLOW IN ${Math.ceil(this.overflowCountdown)}`,
        bx + boxWidth / 2,
        barY - 8,
      )
    } else if (this.isDraining) {
      ctx.fillStyle = COLORS.error
      ctx.font = `bold 18px ${FONT_FAMILY}`
      ctx.textAlign = "center"
      ctx.textBaseline = "alphabetic"
      ctx.fillText("DRAINING...", bx + boxWidth / 2, barY - 8)
    }
  }

  // ── Game loop ──

  lastTime = 0
  accumulator = 0

  start() {
    this.lastTime = performance.now()
    this.loop()
  }

  loop = () => {
    const now = performance.now()
    const frameDt = Math.min((now - this.lastTime) / 1000, 0.1)
    this.lastTime = now

    this.flushSpawnQueue()
    this.updateOverflow(frameDt)
    this.killOffscreen()

    this.accumulator += frameDt
    let steps = 0
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.drag.applySpringForce()
      this.world.step()
      this.accumulator -= FIXED_DT
      steps++
    }
    if (steps >= MAX_SUBSTEPS) this.accumulator = 0

    this.render()
    requestAnimationFrame(this.loop)
  }

  render() {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.width, this.height)

    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, this.width, this.height)

    this.mining.render(ctx, this.width)

    // Overflow vignette (behind letters, on top of background)
    this.renderOverflowVignette(ctx)

    const dpr = window.devicePixelRatio
    const dragging = this.drag.getDragging()
    const hovered = this.drag.getHovered()
    const now = performance.now()

    // Expire foreground status
    for (const [letter, time] of this.foregroundLetters) {
      if (now - time > FOREGROUND_MS) this.foregroundLetters.delete(letter)
    }

    // Basin letters (behind shelf)
    for (const letter of this.letters) {
      if (letter === dragging) continue
      if (this.foregroundLetters.has(letter)) continue
      this.renderer.renderLetter(ctx, letter, dpr, letter === hovered)
    }

    // Shelf (foreground)
    this.shelf.render(ctx)

    // Foreground letters (just released / cleared from shelf)
    for (const [letter] of this.foregroundLetters) {
      if (letter === dragging) continue
      if (!this.letters.includes(letter)) {
        this.foregroundLetters.delete(letter)
        continue
      }
      this.renderer.renderLetter(ctx, letter, dpr, letter === hovered)
    }

    // Dragged letter (topmost)
    if (dragging) {
      this.renderer.renderLetter(ctx, dragging, dpr)
    }

    // Overflow HUD (on top of everything)
    this.renderOverflowHUD(ctx)

    // Economy HUD (topmost layer)
    this.hud.render(ctx, this.width, this.height)

  }
}

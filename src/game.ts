import { type Application, Container, Graphics, Text, Sprite, Texture } from 'pixi.js'
import { PhysicsProxy } from './physics'
import { MiningPrompt } from './mining'
import { DragController } from './drag'
import { Shelf } from './shelf'
import { LetterRenderer } from './render'
import { Economy } from './economy'
import { Hud } from './hud'
import { loadState, startAutoSave, type GameState } from './state'
import {
  getUpgradeValue,
  getUpgradeCost,
  milestoneReached,
  UNIQUE_UPGRADES,
} from './upgrades'
import { renderShop } from './shop.tsx'
import { AutoMiner } from './auto-miner'
import { ApprenticeShelf } from './apprentice-shelf'
import { saveState } from './state'
import { createDevPanel } from './debug'
import { MarkovGenerator, type MarkovData } from './markov'
import {
  SCALE,
  COLORS,
  FIXED_DT,
  MAX_SUBSTEPS,
  FOREGROUND_MS,
  BASIN,
} from './constants'
import type {
  GlyphData,
  LetterBody,
  DictionaryEntry,
  MilestoneName,
  UpgradeTrack,
  UniqueUpgrade,
  BodyState,
} from './types'

export class Game {
  app: Application
  canvas: HTMLCanvasElement
  physics: PhysicsProxy
  glyphs: Record<string, GlyphData>
  letters: LetterBody[] = []
  private letterMap = new Map<number, LetterBody>()
  width = 0
  height = 0

  // Basin overflow state
  overflowCountdown = 0
  isDraining = false
  mining: MiningPrompt
  drag!: DragController
  shelf!: Shelf
  renderer: LetterRenderer
  economy: Economy
  hud: Hud
  dictionary: Record<string, DictionaryEntry> = {}
  foregroundLetters = new Map<LetterBody, number>()

  // Upgrade & progression state
  upgradeLevels: Record<UpgradeTrack, number> = {
    basinCapacity: 0,
    shelfWidth: 0,
    apprenticeShelfWidth: 0,
    miningQuality: 0,
    autoMiner: 0,
    inkMultiplier: 0,
  }
  unlockedUniques: Set<UniqueUpgrade> = new Set()
  highestMilestone: MilestoneName | null = null
  shopOpen = false
  private lastShopRefresh = 0
  private lastShakeTime = 0
  autoMiner: AutoMiner
  siphonMode = false
  apprenticeShelf: ApprenticeShelf | null = null

  private spawnQueue: Array<{ char: string; x: number; y: number }> = []

  // PixiJS layer containers (ordered back-to-front)
  private bgLayer = new Container()
  private miningLayer: Container
  private vignetteLayer = new Container()
  private shelfLayer: Container
  private hudLayer: Container
  private overflowHudContainer = new Container()

  // Overflow vignette — rendered to OffscreenCanvas for gradient support
  private vignetteSprite = new Sprite()
  private vignetteCanvas: OffscreenCanvas | null = null
  private vignetteCtx: OffscreenCanvasRenderingContext2D | null = null

  // Overflow HUD elements
  private overflowContainer = new Container()
  private overflowBg = new Graphics()
  private overflowBarBg = new Graphics()
  private overflowBarFill = new Graphics()
  private overflowBarText: Text
  private overflowMessageText: Text

  constructor(app: Application, physics: PhysicsProxy, glyphs: Record<string, GlyphData>) {
    this.app = app
    this.canvas = app.canvas as HTMLCanvasElement
    this.physics = physics
    this.glyphs = glyphs

    // Renderer
    this.renderer = new LetterRenderer()

    // Economy
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
    const reached = milestoneReached(this.economy.totalInkEarned)
    if (reached) this.highestMilestone = reached

    // Shelf
    this.shelf = new Shelf()
    this.shelf.onSubmit = () => this.submitShelf()

    // Initial shop render
    this.renderShopUI()

    // Build PixiJS scene graph (back-to-front)
    this.shelfLayer = this.shelf.container
    this.hudLayer = this.hud.container

    app.stage.addChild(this.bgLayer)

    // Overflow HUD text objects
    this.overflowBarText = new Text({
      text: '',
      style: {
        fontFamily: 'Playfair Display',
        fontSize: 11,
        fontWeight: 'bold',
        fill: COLORS.ink,
        align: 'center',
      },
    })
    this.overflowBarText.anchor.set(0.5, 0.5)

    this.overflowMessageText = new Text({
      text: '',
      style: {
        fontFamily: 'Playfair Display',
        fontSize: 18,
        fontWeight: 'bold',
        fill: COLORS.error,
        align: 'center',
      },
    })
    this.overflowMessageText.anchor.set(0.5, 1)

    this.overflowContainer.addChild(this.overflowBg)
    this.overflowContainer.addChild(this.overflowBarBg)
    this.overflowContainer.addChild(this.overflowBarFill)
    this.overflowContainer.addChild(this.overflowBarText)
    this.overflowContainer.addChild(this.overflowMessageText)
    this.overflowContainer.visible = false
    this.overflowHudContainer.addChild(this.overflowContainer)

    this.resize()
    window.addEventListener('resize', () => this.resize())

    // Dev panel
    if (import.meta.env.DEV) {
      createDevPanel({
        onToggleGlyphs: () => {
          this.renderer.showGlyphs = !this.renderer.showGlyphs
          return this.renderer.showGlyphs
        },
        onToggleColliders: () => {
          this.renderer.showColliders = !this.renderer.showColliders
          return this.renderer.showColliders
        },
        onSpawnLetters: (count) => {
          const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
          for (let i = 0; i < count; i++) {
            const char = chars[Math.floor(Math.random() * chars.length)]!
            const x = Math.random() * this.width * 0.8 + this.width * 0.1
            const y = Math.random() * this.height * 0.3
            this.spawnLetter(char, x, y)
          }
        },
        onAddInk: (amount) => {
          this.economy.ink += amount
          this.economy.totalInkEarned += amount
          this.checkMilestones()
        },
        onDiscoverWords: (count) => {
          const allWords = Object.keys(this.dictionary)
          const undiscovered = allWords.filter((w) => !this.economy.discoveredWords.has(w))
          for (let i = undiscovered.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[undiscovered[i], undiscovered[j]] = [undiscovered[j]!, undiscovered[i]!]
          }
          const batch = undiscovered.slice(0, count)
          for (const word of batch) {
            this.economy.discoveredWords.add(word)
            const entry = this.dictionary[word]
            if (entry) this.economy.discoveredRoots.add(entry.root)
          }
        },
        onClearDiscoveries: () => {
          this.economy.discoveredWords.clear()
          this.economy.discoveredRoots.clear()
          this.economy.streak = 0
        },
        onResetState: () => {
          localStorage.removeItem('letter-mine-save')
          location.reload()
        },
        onForceSave: () => {
          saveState(this.buildSaveState())
        },
        getStats: () => ({
          ink: this.economy.ink,
          totalInk: this.economy.totalInkEarned,
          discovered: this.economy.discoveredWords.size,
          letters: this.letters.length,
          streak: this.economy.streak,
        }),
      })
    }

    // Mining prompt
    this.mining = new MiningPrompt({
      onLetterMined: (char, screenX, screenY) => {
        this.spawnLetter(char, screenX, screenY)
        this.economy.creditLetterMined()
      },
    })
    this.miningLayer = this.mining.container

    // Rebuild scene graph now that mining exists
    this.rebuildSceneGraph()

    // Auto-miner
    this.autoMiner = new AutoMiner(this.mining)

    // Apply all upgrade side effects
    this.applyAllUpgrades()

    // Drag controller
    this.drag = new DragController(
      this.canvas,
      this.physics,
      this.letters,
      this.shelf,
      (letter) => {
        const idx = this.letters.indexOf(letter)
        if (idx >= 0) this.letters.splice(idx, 1)
        this.letterMap.delete(letter.id)
        this.foregroundLetters.delete(letter)
        this.renderer.removeSprite(letter)
      },
      (char, screenX, screenY) => {
        const glyph = this.glyphs[char]
        if (!glyph) return null
        const letter = this.physics.spawn(glyph, screenX, screenY)
        this.letters.push(letter)
        this.letterMap.set(letter.id, letter)
        this.renderer.createSprite(letter)
        return letter
      },
      (letter) => {
        this.foregroundLetters.set(letter, performance.now())
      },
    )

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.shopOpen) {
        this.closeShop()
        return
      }

      if (e.key === 'Tab' && this.unlockedUniques.has('siphon')) {
        e.preventDefault()
        this.siphonMode = !this.siphonMode
        this.mining.paused = this.siphonMode
        this.shelf.siphonActive = this.siphonMode
        return
      }

      if (this.siphonMode && e.key === 'Backspace') {
        e.preventDefault()
        this.siphonBackspace()
        return
      }

      if (this.siphonMode && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        this.siphonLetter(e.key)
        return
      }

      if (e.key === 'Enter') {
        this.submitShelf()
      } else if (e.key === 'Escape') {
        this.dumpShelfLetters()
      } else if (e.key === ' ' && e.shiftKey && this.unlockedUniques.has('basinShake')) {
        e.preventDefault()
        this.basinShake()
      }
    })

    this.loadDictionary()
    this.loadMarkov()

    startAutoSave(() => this.buildSaveState())
  }

  private rebuildSceneGraph() {
    const stage = this.app.stage
    stage.removeChildren()

    // Back-to-front ordering
    stage.addChild(this.bgLayer)
    stage.addChild(this.miningLayer)
    stage.addChild(this.vignetteLayer)
    this.vignetteLayer.addChild(this.vignetteSprite)
    stage.addChild(this.renderer.basinLayer)
    stage.addChild(this.shelfLayer)
    stage.addChild(this.renderer.foregroundLayer)
    stage.addChild(this.renderer.dragLayer)
    stage.addChild(this.overflowHudContainer)
    stage.addChild(this.hudLayer)
  }

  resize() {
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.app.renderer.resize(this.width, this.height)

    this.physics.rebuildWalls(this.width, this.height, this.isDraining)
    this.shelf.rebuild(this.width, this.height)
  }

  removeFloor() {
    this.physics.removeFloor()
  }

  restoreFloor() {
    this.physics.restoreFloor(this.height)
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
      console.warn('Dictionary not found -- shelf validation disabled')
    }
  }

  async loadMarkov() {
    try {
      const resp = await fetch(`${import.meta.env.BASE_URL}markov.json`)
      const data = (await resp.json()) as MarkovData
      this.mining.markov = new MarkovGenerator(data)
      console.log(
        `Markov chain loaded: ${data.starts.length} starts, ${Object.keys(data.transitions).length} transitions`,
      )
    } catch {
      console.warn('Markov data not found — using fallback word list')
    }
  }

  // -- Progression --

  buildSaveState(): GameState {
    return {
      ...this.economy.toPartialState(),
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
      this.renderShopUI()
    }
  }

  openShop() {
    this.shopOpen = true
    this.renderShopUI()
  }

  closeShop() {
    this.shopOpen = false
    this.renderShopUI()
  }

  renderShopUI() {
    renderShop({
      open: this.shopOpen,
      ink: this.economy.ink,
      milestone: this.highestMilestone,
      upgradeLevels: this.upgradeLevels,
      ownedUniques: this.unlockedUniques,
      showButton: this.economy.discoveredWords.size > 0 || this.highestMilestone !== null,
      onOpen: () => this.openShop(),
      onClose: () => this.closeShop(),
      onBuyTiered: (track) => this.buyTieredUpgrade(track),
      onBuyUnique: (id) => this.buyUniqueUpgrade(id),
    })
  }

  getBasinCapacity(): number {
    return getUpgradeValue('basinCapacity', this.upgradeLevels.basinCapacity)
  }

  buyTieredUpgrade(track: UpgradeTrack) {
    const level = this.upgradeLevels[track]
    const cost = getUpgradeCost(track, level)
    if (cost === null) return
    if (!this.economy.spendInk(cost)) return
    this.upgradeLevels[track] = level + 1
    this.applyUpgrade(track)
    saveState(this.buildSaveState())
    this.renderShopUI()
  }

  buyUniqueUpgrade(id: UniqueUpgrade) {
    if (this.unlockedUniques.has(id)) return
    const def = UNIQUE_UPGRADES.find((u) => u.id === id)
    if (!def) return
    if (!this.economy.spendInk(def.cost)) return
    this.unlockedUniques.add(id)
    this.applyUniqueUpgrade(id)
    saveState(this.buildSaveState())
    this.renderShopUI()
  }

  applyUniqueUpgrade(id: UniqueUpgrade) {
    switch (id) {
      case 'wordCheck':
        this.shelf.wordCheckEnabled = true
        break
      case 'apprenticeShelf':
        if (!this.apprenticeShelf) {
          this.apprenticeShelf = new ApprenticeShelf({
            getLetters: () => this.letters,
            removeLetter: (letter) => {
              this.physics.remove(letter.id)
              const idx = this.letters.indexOf(letter)
              if (idx >= 0) this.letters.splice(idx, 1)
              this.letterMap.delete(letter.id)
              this.foregroundLetters.delete(letter)
              this.renderer.removeSprite(letter)
            },
            getDiscoveredWords: () => this.economy.discoveredWords,
            getDictionary: () => this.dictionary,
            onWordAssembled: (word) => {
              const entry = this.dictionary[word]
              this.economy.scoreWord(word, [], entry)
              this.checkMilestones()
            },
          })
          this.apprenticeShelf.maxLength = getUpgradeValue(
            'apprenticeShelfWidth',
            this.upgradeLevels.apprenticeShelfWidth,
          )
        }
        break
      case 'autoDiscovery':
        if (this.apprenticeShelf) {
          this.apprenticeShelf.canDiscover = true
        }
        break
    }
  }

  applyUpgrade(track: UpgradeTrack) {
    const value = getUpgradeValue(track, this.upgradeLevels[track])
    switch (track) {
      case 'basinCapacity':
        break
      case 'shelfWidth':
        this.shelf.maxSlots = value
        break
      case 'inkMultiplier':
        this.economy.inkMultiplierBonus = value
        break
      case 'miningQuality':
        this.economy.letterMinedInk = value
        break
      case 'autoMiner':
        this.autoMiner.rate = value
        break
      case 'apprenticeShelfWidth':
        if (this.apprenticeShelf) {
          this.apprenticeShelf.maxLength = value
        }
        break
    }
  }


  siphonLetter(key: string) {
    const shelfY = this.shelf.y / SCALE
    let best: LetterBody | null = null
    let bestDist = Infinity

    for (const letter of this.letters) {
      if (letter.char.toLowerCase() !== key.toLowerCase()) continue
      const dist = Math.abs(letter.y - shelfY)
      if (dist < bestDist) {
        bestDist = dist
        best = letter
      }
    }

    if (!best) return

    const placed = this.shelf.placeLetter(best.char, best.isUpper)
    if (!placed) return

    this.physics.remove(best.id)
    const idx = this.letters.indexOf(best)
    if (idx >= 0) this.letters.splice(idx, 1)
    this.letterMap.delete(best.id)
    this.foregroundLetters.delete(best)
    this.renderer.removeSprite(best)
  }

  siphonBackspace() {
    if (this.shelf.letters.length === 0) return
    this.dumpShelfLetters(this.shelf.letters.length - 1)
  }

  basinShake() {
    const now = performance.now()
    if (now - this.lastShakeTime < 3000) return
    this.lastShakeTime = now
    for (const letter of this.letters) {
      const ix = (Math.random() - 0.5) * 8
      const iy = -(Math.random() * 4 + 2)
      this.physics.applyImpulse(letter.id, ix, iy)
      this.physics.applyTorqueImpulse(letter.id, (Math.random() - 0.5) * 2)
    }
  }

  applyAllUpgrades() {
    for (const track of Object.keys(this.upgradeLevels) as UpgradeTrack[]) {
      this.applyUpgrade(track)
    }
    for (const id of this.unlockedUniques) {
      this.applyUniqueUpgrade(id)
    }
  }

  submitShelf() {
    if (this.shelf.letters.length === 0) return
    const result = this.shelf.submit()
    if (result.valid) {
      const normalized = result.word.toLowerCase()
      const entry = this.dictionary[normalized]
      const score = this.economy.scoreWord(result.word, result.submittedLetters, entry)
      console.log(
        `Submitted: ${result.word} -> +${score.finalInk} Ink`,
        score.bonuses.map((b) => b.label).join(', '),
      )
      this.checkMilestones()
      this.renderShopUI()
    } else {
      this.economy.resetStreak()
      this.dumpShelfLetters(result.letters)
    }
  }

  dumpShelfLetters(target?: number | Array<{ char: string }>) {
    if (typeof target === 'number') {
      const pos = this.shelf.slotPosition(target)
      const removed = this.shelf.removeLetter(target)
      if (!removed) return
      this.spawnLetter(removed.char, pos.x, pos.y)
      this.pendingForeground = performance.now()
      return
    }

    let letters = target
    if (!letters) {
      letters = [...this.shelf.letters]
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

  private pendingForeground = 0

  spawnLetter(char: string, x: number, y: number) {
    this.spawnQueue.push({ char, x, y })
  }

  private flushSpawnQueue() {
    const markForeground = this.pendingForeground > 0
    for (const s of this.spawnQueue) {
      const glyph = this.glyphs[s.char]
      if (!glyph) continue
      const letter = this.physics.spawn(glyph, s.x, s.y)
      this.letters.push(letter)
      this.letterMap.set(letter.id, letter)
      this.renderer.createSprite(letter)
      if (markForeground) {
        this.foregroundLetters.set(letter, this.pendingForeground)
      }
    }
    this.spawnQueue.length = 0
    this.pendingForeground = 0
  }

  // -- Basin overflow --

  updateOverflow(dt: number) {
    const count = this.letters.length
    const max = this.getBasinCapacity()

    if (this.isDraining) {
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
        this.isDraining = true
        this.overflowCountdown = 0
        this.removeFloor()
        this.dumpShelfLetters()
      }
    } else {
      this.overflowCountdown = 0
    }
  }

  killOffscreen() {
    const killY = (this.height + BASIN.killPlaneOffset) / SCALE
    for (let i = this.letters.length - 1; i >= 0; i--) {
      const letter = this.letters[i]!
      if (letter.y > killY) {
        this.physics.remove(letter.id)
        this.letterMap.delete(letter.id)
        this.foregroundLetters.delete(letter)
        this.renderer.removeSprite(letter)
        this.letters.splice(i, 1)
      }
    }
  }

  renderOverflowVignette() {
    const count = this.letters.length
    const max = this.getBasinCapacity()
    const warnAt = Math.floor(max * BASIN.warnRatio)

    if (count < warnAt && !this.isDraining) {
      this.vignetteSprite.visible = false
      return
    }

    let intensity = Math.min(1, (count - warnAt) / (max - warnAt))

    if (this.overflowCountdown > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150)
      intensity = Math.max(intensity, 0.6 + 0.4 * pulse)
    } else if (this.isDraining) {
      intensity = 1
    }

    if (intensity <= 0) {
      this.vignetteSprite.visible = false
      return
    }

    const dpr = window.devicePixelRatio
    const w = this.width
    const h = this.height

    // Lazily create / resize the offscreen canvas
    if (!this.vignetteCanvas || this.vignetteCanvas.width !== w * dpr || this.vignetteCanvas.height !== h * dpr) {
      this.vignetteCanvas = new OffscreenCanvas(w * dpr, h * dpr)
      this.vignetteCtx = this.vignetteCanvas.getContext('2d')
    }
    const ctx = this.vignetteCtx!
    ctx.clearRect(0, 0, w * dpr, h * dpr)
    ctx.save()
    ctx.scale(dpr, dpr)

    const alpha = intensity * 0.35
    const spread = 60 + intensity * 80

    // Top edge
    const topGrad = ctx.createLinearGradient(0, 0, 0, spread)
    topGrad.addColorStop(0, `rgba(192, 57, 43, ${alpha})`)
    topGrad.addColorStop(1, 'rgba(192, 57, 43, 0)')
    ctx.fillStyle = topGrad
    ctx.fillRect(0, 0, w, spread)

    // Bottom edge
    const botGrad = ctx.createLinearGradient(0, h, 0, h - spread)
    botGrad.addColorStop(0, `rgba(192, 57, 43, ${alpha})`)
    botGrad.addColorStop(1, 'rgba(192, 57, 43, 0)')
    ctx.fillStyle = botGrad
    ctx.fillRect(0, h - spread, w, spread)

    // Left edge
    const leftGrad = ctx.createLinearGradient(0, 0, spread, 0)
    leftGrad.addColorStop(0, `rgba(192, 57, 43, ${alpha * 0.6})`)
    leftGrad.addColorStop(1, 'rgba(192, 57, 43, 0)')
    ctx.fillStyle = leftGrad
    ctx.fillRect(0, 0, spread, h)

    // Right edge
    const rightGrad = ctx.createLinearGradient(w, 0, w - spread, 0)
    rightGrad.addColorStop(0, `rgba(192, 57, 43, ${alpha * 0.6})`)
    rightGrad.addColorStop(1, 'rgba(192, 57, 43, 0)')
    ctx.fillStyle = rightGrad
    ctx.fillRect(w - spread, 0, spread, h)

    ctx.restore()

    // Upload to sprite texture
    const oldTex = this.vignetteSprite.texture
    if (oldTex !== Texture.EMPTY) oldTex.destroy(true)
    this.vignetteSprite.texture = Texture.from({
      resource: this.vignetteCanvas.transferToImageBitmap(),
      resolution: dpr,
    })
    this.vignetteSprite.visible = true
  }

  renderOverflowHUD() {
    const count = this.letters.length
    const max = this.getBasinCapacity()
    const warnAt = Math.floor(max * BASIN.warnRatio)

    if (count < warnAt && !this.isDraining) {
      this.overflowContainer.visible = false
      return
    }

    this.overflowContainer.visible = true
    const isOver = count > max
    const hasMessage = this.overflowCountdown > 0 || this.isDraining
    const boxWidth = 240
    const boxHeight = hasMessage ? 64 : 36
    const bx = (this.width - boxWidth) / 2
    const shelfTop = this.shelf.rect.y
    const by = shelfTop - boxHeight - 12

    // Container background
    this.overflowBg.clear()
    this.overflowBg.roundRect(bx, by, boxWidth, boxHeight, 8)
    this.overflowBg.fill(COLORS.bg)
    this.overflowBg.roundRect(bx, by, boxWidth, boxHeight, 8)
    this.overflowBg.stroke({
      color: isOver ? COLORS.error : COLORS.shelf,
      width: 2,
    })

    const barPad = 16
    const barWidth = boxWidth - barPad * 2
    const barHeight = 14
    const barX = bx + barPad
    const barY = by + boxHeight - barHeight - 10

    this.overflowBarBg.clear()
    this.overflowBarBg.roundRect(barX, barY, barWidth, barHeight, 4)
    this.overflowBarBg.fill({ color: 0x000000, alpha: 0.08 })

    const ratio = Math.min(1, count / max)
    this.overflowBarFill.clear()
    this.overflowBarFill.roundRect(barX, barY, barWidth * ratio, barHeight, 4)
    this.overflowBarFill.fill(isOver ? COLORS.error : COLORS.valid)

    this.overflowBarText.text = `${count} / ${max}`
    this.overflowBarText.position.set(barX + barWidth / 2, barY + barHeight / 2)

    if (this.overflowCountdown > 0) {
      this.overflowMessageText.visible = true
      this.overflowMessageText.text = `OVERFLOW IN ${Math.ceil(this.overflowCountdown)}`
      this.overflowMessageText.position.set(bx + boxWidth / 2, barY - 8)
    } else if (this.isDraining) {
      this.overflowMessageText.visible = true
      this.overflowMessageText.text = 'DRAINING...'
      this.overflowMessageText.position.set(bx + boxWidth / 2, barY - 8)
    } else {
      this.overflowMessageText.visible = false
    }
  }

  // -- Game loop --

  lastTime = 0
  accumulator = 0
  private waitingForStep = false

  start() {
    this.lastTime = performance.now()
    this.loop()
  }

  loop = () => {
    const now = performance.now()
    const frameDt = Math.min((now - this.lastTime) / 1000, 0.1)
    this.lastTime = now

    this.autoMiner.update(frameDt)
    this.apprenticeShelf?.update(frameDt)
    this.flushSpawnQueue()
    if (now - this.lastShopRefresh > 500) {
      this.lastShopRefresh = now
      this.renderShopUI()
    }
    this.updateOverflow(frameDt)
    this.killOffscreen()

    this.accumulator += frameDt
    let steps = 0
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.drag.applySpringForce()
      this.accumulator -= FIXED_DT
      steps++
    }
    if (steps >= MAX_SUBSTEPS) this.accumulator = 0

    if (steps > 0 && !this.waitingForStep) {
      this.waitingForStep = true
      let remaining = steps
      const stepOnce = () => {
        this.physics.step((bodies) => {
          this.applyBodyStates(bodies)
          remaining--
          if (remaining > 0) {
            this.drag.applySpringForce()
            stepOnce()
          } else {
            this.waitingForStep = false
            this.render()
            this.app.renderer.render(this.app.stage)
            requestAnimationFrame(this.loop)
          }
        })
      }
      stepOnce()
    } else {
      this.render()
      this.app.renderer.render(this.app.stage)
      requestAnimationFrame(this.loop)
    }
  }

  private applyBodyStates(bodies: BodyState[]) {
    for (const state of bodies) {
      const letter = this.letterMap.get(state.id)
      if (letter) {
        letter.x = state.x
        letter.y = state.y
        letter.rotation = state.rotation
      }
    }
  }

  render() {
    this.mining.render(this.width)

    // Overflow vignette
    this.renderOverflowVignette()

    const dragging = this.drag.getDragging()
    const hovered = this.drag.getHovered()
    const now = performance.now()

    for (const [letter, time] of this.foregroundLetters) {
      if (now - time > FOREGROUND_MS) this.foregroundLetters.delete(letter)
    }

    const compassChars = this.unlockedUniques.has('wordCompass')
      ? this.shelf.getCompassChars(this.economy.discoveredWords).available
      : null

    const ghostChars =
      this.unlockedUniques.has('wordGhost') && !compassChars
        ? this.shelf.getCompletionChars()
        : null

    const vowelBloom = this.unlockedUniques.has('vowelBloom')
    const vowels = 'aeiouAEIOU'
    const getGlow = (letter: LetterBody): string | null => {
      const lc = letter.char.toLowerCase()
      if (compassChars?.has(lc)) return '#4A7C59'
      if (ghostChars?.has(lc)) return '#6B4423'
      if (vowelBloom && vowels.includes(letter.char)) return '#8B7355'
      return null
    }

    // Update all letter sprites and assign them to the correct layer
    for (const letter of this.letters) {
      const isForeground = this.foregroundLetters.has(letter)
      const isDrag = letter === dragging

      if (isDrag) {
        this.renderer.moveToLayer(letter, this.renderer.dragLayer)
      } else if (isForeground) {
        this.renderer.moveToLayer(letter, this.renderer.foregroundLayer)
      } else {
        this.renderer.moveToLayer(letter, this.renderer.basinLayer)
      }

      this.renderer.updateSprite(letter, letter === hovered, getGlow(letter))
    }

    // Shelf
    this.shelf.render()

    // Overflow HUD
    this.renderOverflowHUD()

    // Economy HUD
    this.hud.render(this.width, this.height)
  }
}

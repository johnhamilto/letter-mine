import { type Application, Container, Graphics, Text, Sprite, Texture } from 'pixi.js'
import { PhysicsProxy } from './physics'
import { MiningPrompt } from './mining'
import { DragController } from './drag'
import { Shelf } from './shelf'
import { LetterRenderer } from './render'
import { Economy } from './economy'
import { Hud } from './hud'
import { loadState, startAutoSave, DEFAULT_SETTINGS, type GameState, type Settings } from './state'
import { getUpgradeValue, getUpgradeCost, milestoneReached, UNIQUE_UPGRADES } from './upgrades'
import { renderShop } from './shop.tsx'
import { renderSettings } from './settings.tsx'
import { renderDictionaryScreen } from './dictionary-screen.tsx'
import { AutoMiner } from './auto-miner'
import { ApprenticeShelf } from './apprentice-shelf'
import { saveState } from './state'
import { createDevPanel } from './debug'
import { MarkovGenerator, type MarkovData } from './markov'
import { SoundManager } from './sound'
import { PerfMonitor } from './perf-monitor'
import { SCALE, COLORS, FIXED_DT, MAX_SUBSTEPS, FOREGROUND_MS, BASIN, MINING } from './constants'
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
  private drainTimer = 0
  mining: MiningPrompt
  drag!: DragController
  shelf!: Shelf
  renderer: LetterRenderer
  economy: Economy
  hud: Hud
  dictionary: Record<string, DictionaryEntry> = {}
  private totalWordsCount = 0
  foregroundLetters = new Map<LetterBody, number>()
  sound: SoundManager

  // Upgrade & progression state
  upgradeLevels: Record<UpgradeTrack, number> = {
    basinCapacity: 0,
    shelfWidth: 0,
    apprenticeShelfWidth: 0,
    apprenticeSpeed: 0,
    miningQuality: 0,
    autoMiner: 0,
    inkMultiplier: 0,
    scribesBalance: 0,
    parallelPresses: 0,
    typeFoundry: 0,
    alchemy: 0,
  }
  unlockedUniques: Set<UniqueUpgrade> = new Set()
  highestMilestone: MilestoneName | null = null
  settings: Settings = { ...DEFAULT_SETTINGS }
  shopOpen = false
  settingsOpen = false
  dictionaryOpen = false
  private lastShopRefresh = 0
  private lastShakeTime = 0
  private alchemyTimer = 0
  private ghostCache: { word: string; maxSlots: number; chars: Set<string> } | null = null
  private lastGhostRefresh = 0
  autoMiner: AutoMiner
  perfMonitor!: PerfMonitor
  siphonMode = false
  apprenticeShelves: ApprenticeShelf[] = []
  /** Dictionary root → all words sharing that root. Built once after dictionary loads. */
  private familyMap = new Map<string, string[]>()

  private censusEl: HTMLDivElement | null = null
  private censusCountEls: Record<string, HTMLSpanElement> = {}
  private censusItemEls: Record<string, HTMLSpanElement> = {}

  private spawnQueue: Array<{ char: string; x: number; y: number }> = []
  private lastOverflowTick = 0

  // PixiJS layer containers (ordered back-to-front)
  private bgLayer = new Container()
  private miningLayer: Container
  private vignetteLayer = new Container()
  private shelfLayer: Container
  private hudLayer: Container
  private overflowHudContainer = new Container()

  // Overflow vignette — baked once to a texture, intensity modulated via sprite alpha
  private vignetteSprite = new Sprite()
  private vignetteBakedW = 0
  private vignetteBakedH = 0

  // Overflow HUD elements
  private overflowContainer = new Container()
  private overflowBg = new Graphics()
  private overflowBarBg = new Graphics()
  private overflowBarFill = new Graphics()
  private overflowBarText: Text
  private overflowMessageText: Text
  private overflowTopY: number | null = null

  constructor(app: Application, physics: PhysicsProxy, glyphs: Record<string, GlyphData>) {
    this.app = app
    this.canvas = app.canvas as HTMLCanvasElement
    this.physics = physics
    this.glyphs = glyphs

    // Renderer
    this.renderer = new LetterRenderer()
    this.renderer.initAtlas(glyphs)

    // Sound
    this.sound = new SoundManager()
    this.sound.loadAll(`${import.meta.env.BASE_URL}`)

    // Economy
    this.economy = new Economy()
    const saved = loadState()
    if (saved) {
      this.economy.fromState(saved)
      // Merge saved levels over defaults so new tracks get level 0 instead of undefined
      this.upgradeLevels = { ...this.upgradeLevels, ...saved.upgradeLevels }
      this.unlockedUniques = new Set(saved.unlockedUniques)
      this.highestMilestone = saved.highestMilestone
      this.settings = { ...DEFAULT_SETTINGS, ...saved.settings }
    }
    this.sound.muted = this.settings.muted

    // Perf monitor (optional, user-toggled)
    this.perfMonitor = new PerfMonitor(() => this.letters.length)
    this.perfMonitor.enabled = this.settings.perfMonitorEnabled
    this.hud = new Hud(this.economy)
    this.hud.getMilestone = () => this.highestMilestone
    this.hud.getTotalWords = () => this.totalWordsCount
    this.hud.onDictionaryOpen = () => this.openDictionary()
    this.hud.perfSink = (name, ms) => this.perfMonitor.recordPhase(`hud.${name}`, ms)
    const reached = milestoneReached(
      this.economy.discoveredWords.size,
      Object.keys(this.dictionary).length,
    )
    if (reached) this.highestMilestone = reached

    // Shelf
    this.shelf = new Shelf()
    this.shelf.onSubmit = () => this.submitShelf()

    // Initial shop render
    this.renderShopUI()
    this.renderDictionaryUI()

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
        }),
      })
    }

    // Mining prompt
    this.mining = new MiningPrompt({
      onLetterMined: (char, screenX, screenY) => {
        this.spawnLetter(char, screenX, screenY)
        this.economy.creditLetterMined()
        this.pulseCensus(char)
      },
      onKeystroke: () => {
        this.sound.playKeyClick()
      },
    })
    this.miningLayer = this.mining.container

    // Rebuild scene graph now that mining exists
    this.rebuildSceneGraph()

    // Auto-miner — spawns frequency-weighted letters when idle, biased by Scribe's Balance
    this.autoMiner = new AutoMiner(
      (char, isFirstInBatch) => {
        const x = this.width * (0.1 + Math.random() * 0.8)
        const y = -30 - Math.random() * 40
        this.spawnLetter(char, x, y)
        this.economy.creditLetterMined()
        // One keyclick per strike — Type Foundry batches would otherwise pile up
        // into a wall of clicks on each tick.
        if (isFirstInBatch) this.sound.playKeyClick()
        this.pulseCensus(char)
      },
      () => {
        const counts = new Map<string, number>()
        for (const letter of this.letters) {
          const c = letter.char.toLowerCase()
          counts.set(c, (counts.get(c) ?? 0) + 1)
        }
        return counts
      },
    )

    this.autoMiner.shouldPause = () =>
      this.getLetterCount() >= this.getBasinCapacity() * this.settings.autoMinerCapPercent

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
        this.sound.playKeyClick()
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
    this.drag.onShiftClickLetter = (letter) => {
      if (!this.unlockedUniques.has('compositorsPick')) return false
      this.physics.remove(letter.id)
      const idx = this.letters.indexOf(letter)
      if (idx >= 0) this.letters.splice(idx, 1)
      this.letterMap.delete(letter.id)
      this.foregroundLetters.delete(letter)
      this.renderer.removeSprite(letter)
      return true
    }

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.dictionaryOpen) {
        this.closeDictionary()
        return
      }

      if (e.key === 'Escape' && this.shopOpen) {
        this.closeShop()
        return
      }

      if (e.key === 'Escape' && this.settingsOpen) {
        this.closeSettings()
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
        this.sound.playKeyClick()
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
    for (const a of this.apprenticeShelves) {
      stage.addChild(a.container)
    }
  }

  resize() {
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.app.renderer.resize(this.width, this.height)

    this.physics.rebuildWalls(this.width, this.height, this.isDraining)
    this.shelf.rebuild(this.width, this.height)
    for (const a of this.apprenticeShelves) a.resize(this.width)
    this.positionCensus()
  }

  private ensureCensusEl() {
    if (this.censusEl) return
    const el = document.createElement('div')
    el.className = 'letter-census'
    const chars = 'abcdefghijklmnopqrstuvwxyz'
    for (const c of chars) {
      const item = document.createElement('span')
      item.className = 'lc-item'
      const letter = document.createElement('span')
      letter.className = 'lc-letter'
      letter.textContent = c
      const count = document.createElement('span')
      count.className = 'lc-count'
      count.textContent = '0'
      item.appendChild(letter)
      item.appendChild(count)
      el.appendChild(item)
      this.censusItemEls[c] = item
      this.censusCountEls[c] = count
    }
    document.body.appendChild(el)
    this.censusEl = el
    this.positionCensus()
  }

  private positionCensus() {
    if (!this.censusEl) return
    const shelfBottom = this.shelf.y + this.shelf.shelfHeight
    this.censusEl.style.top = `${shelfBottom + 14}px`
  }

  /** Trigger the pulse animation for a given letter's census cell. */
  pulseCensus(char: string) {
    if (!this.unlockedUniques.has('letterCount')) return
    const item = this.censusItemEls[char.toLowerCase()]
    if (!item) return
    // Restart the animation by removing and re-adding the class on next frame
    item.classList.remove('lc-pulse')
    // Force reflow so the animation can restart
    void item.offsetWidth
    item.classList.add('lc-pulse')
  }

  private renderCensus() {
    if (!this.unlockedUniques.has('letterCount')) {
      if (this.censusEl) this.censusEl.style.display = 'none'
      return
    }

    this.ensureCensusEl()
    this.censusEl!.style.display = ''

    const counts = new Map<string, number>()
    for (const letter of this.letters) {
      const lc = letter.char.toLowerCase()
      counts.set(lc, (counts.get(lc) ?? 0) + 1)
    }

    const chars = 'abcdefghijklmnopqrstuvwxyz'
    for (const c of chars) {
      const n = counts.get(c) ?? 0
      const item = this.censusItemEls[c]!
      const countEl = this.censusCountEls[c]!
      if (countEl.textContent !== String(n)) countEl.textContent = String(n)
      item.classList.toggle('lc-zero', n === 0)
    }
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
      this.totalWordsCount = words.size
      this.shelf.loadDictionary(words)
      this.shelf.discoveredWords = this.economy.discoveredWords
      this.buildFamilyMap()

      console.log(`Dictionary loaded: ${words.size} words`)
    } catch {
      console.warn('Dictionary not found -- shelf validation disabled')
    }
  }

  /** Group every dictionary word by its root field so Imprimatur can expand families in O(1). */
  private buildFamilyMap() {
    this.familyMap.clear()
    for (const word in this.dictionary) {
      const root = this.dictionary[word]!.root
      let family = this.familyMap.get(root)
      if (!family) {
        family = []
        this.familyMap.set(root, family)
      }
      family.push(word)
    }
  }

  /**
   * Imprimatur hook — called after every scored word (player submit or apprentice).
   * Silently discovers the submitted word's family members if the upgrade is owned.
   */
  private expandFamily(root: string) {
    if (!this.unlockedUniques.has('imprimatur')) return
    const family = this.familyMap.get(root)
    if (!family) return
    const added = this.economy.discoverFamily(family)
    if (added.length > 0) {
      this.hud.showFamilyFlash(added.length)
      this.checkMilestones()
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
      settings: { ...this.settings },
    }
  }

  checkMilestones() {
    const reached = milestoneReached(
      this.economy.discoveredWords.size,
      Object.keys(this.dictionary).length,
    )
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
    this.renderSettingsUI()
  }

  openSettings() {
    this.settingsOpen = true
    if (this.shopOpen) this.shopOpen = false
    this.renderShopUI()
  }

  closeSettings() {
    this.settingsOpen = false
    this.renderShopUI()
  }

  renderSettingsUI() {
    renderSettings({
      open: this.settingsOpen,
      settings: this.settings,
      basinCapacity: this.getBasinCapacity(),
      onOpen: () => this.openSettings(),
      onClose: () => this.closeSettings(),
      onChange: (patch) => this.updateSettings(patch),
    })
  }

  updateSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch }
    if (patch.muted !== undefined) this.sound.muted = patch.muted
    if (patch.perfMonitorEnabled !== undefined) {
      this.perfMonitor.enabled = patch.perfMonitorEnabled
    }
    saveState(this.buildSaveState())
    this.renderSettingsUI()
  }

  openDictionary() {
    this.dictionaryOpen = true
    this.renderDictionaryUI()
  }

  closeDictionary() {
    this.dictionaryOpen = false
    this.renderDictionaryUI()
  }

  renderDictionaryUI() {
    renderDictionaryScreen({
      open: this.dictionaryOpen,
      discoveredWords: this.economy.discoveredWords,
      dictionary: this.dictionary,
      totalInkEarned: this.economy.totalInkEarned,
      onClose: () => this.closeDictionary(),
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
    if (id === 'imprimatur') this.runImprimaturSweep()
    saveState(this.buildSaveState())
    this.renderShopUI()
  }

  /**
   * One-shot retroactive family expansion that fires when Imprimatur is first
   * purchased. Every already-discovered root releases its full family into the
   * discovered set. Purchase-time only — does not replay on reload.
   */
  private runImprimaturSweep() {
    let total = 0
    for (const root of this.economy.discoveredRoots) {
      const family = this.familyMap.get(root)
      if (!family) continue
      total += this.economy.discoverFamily(family).length
    }
    if (total > 0) {
      this.hud.showImprimaturSweep(total)
      this.checkMilestones()
    }
  }

  applyUniqueUpgrade(id: UniqueUpgrade) {
    switch (id) {
      case 'wordCheck':
        this.shelf.wordCheckEnabled = true
        break
      case 'apprenticeShelf':
        this.syncApprenticeCount()
        break
      case 'autoDiscovery':
        for (const a of this.apprenticeShelves) a.preferHighValue = true
        break
      case 'imprimatur':
        // Runtime state is just the flag on unlockedUniques; the retroactive
        // sweep is a purchase-time event handled in buyUniqueUpgrade.
        break
    }
  }

  /** Build a fresh ApprenticeShelf wired to the game's callbacks. */
  private createApprentice(): ApprenticeShelf {
    // Capture `shelf` in a holder so `getBlockedLetters` can exclude self.
    const holder: { shelf: ApprenticeShelf | null } = { shelf: null }
    const shelf = new ApprenticeShelf({
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
      getBlockedLetters: () => this.aggregateReservedLetters(holder.shelf),
      getBlockedWords: () => this.aggregateReservedWords(holder.shelf),
      onWordAssembled: (word) => {
        const entry = this.dictionary[word]
        const score = this.economy.scoreWord(word, [], entry)
        this.hud.showScore(score)
        if (this.unlockedUniques.has('subWordHarvest')) {
          this.harvestSubWords(word)
        }
        this.expandFamily(entry?.root ?? word)
        this.checkMilestones()
      },
    })
    holder.shelf = shelf
    shelf.maxLength = getUpgradeValue(
      'apprenticeShelfWidth',
      this.upgradeLevels.apprenticeShelfWidth,
    )
    shelf.assemblyMs = getUpgradeValue('apprenticeSpeed', this.upgradeLevels.apprenticeSpeed) * 1000
    shelf.preferHighValue = this.unlockedUniques.has('autoDiscovery')
    shelf.resize(this.width)
    return shelf
  }

  /** Aggregate the letter reservations of every apprentice except `exclude`. */
  private aggregateReservedLetters(exclude: ApprenticeShelf | null): Map<string, number> {
    const blocked = new Map<string, number>()
    for (const a of this.apprenticeShelves) {
      if (a === exclude) continue
      for (const [ch, n] of a.getReservedLetters()) {
        blocked.set(ch, (blocked.get(ch) ?? 0) + n)
      }
    }
    return blocked
  }

  /** Words every apprentice except `exclude` is currently assembling. */
  private aggregateReservedWords(exclude: ApprenticeShelf | null): Set<string> {
    const words = new Set<string>()
    for (const a of this.apprenticeShelves) {
      if (a === exclude) continue
      const w = a.getReservedWord()
      if (w) words.add(w)
    }
    return words
  }

  /**
   * Spawn / trim apprentice shelves to match the Parallel Presses upgrade value.
   * No-op until the Apprentice Shelf unique upgrade has been purchased.
   */
  private syncApprenticeCount() {
    if (!this.unlockedUniques.has('apprenticeShelf')) return
    const target = getUpgradeValue('parallelPresses', this.upgradeLevels.parallelPresses)
    while (this.apprenticeShelves.length < target) {
      this.apprenticeShelves.push(this.createApprentice())
    }
    while (this.apprenticeShelves.length > target) {
      const removed = this.apprenticeShelves.pop()
      if (removed) {
        removed.container.removeFromParent()
        removed.destroy()
      }
    }
    this.rebuildSceneGraph()
  }

  /**
   * Auto-miner configuration:
   *   rate          = base (auto-miner tier)      — strikes per second
   *   outputPerTick = Type Foundry level          — letters cast per strike
   */
  private updateAutoMinerRate() {
    const base = getUpgradeValue('autoMiner', this.upgradeLevels.autoMiner)
    const foundry = getUpgradeValue('typeFoundry', this.upgradeLevels.typeFoundry)
    this.autoMiner.rate = base
    this.autoMiner.outputPerTick = Math.max(1, Math.floor(foundry))
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
      case 'typeFoundry':
        this.updateAutoMinerRate()
        break
      case 'apprenticeShelfWidth':
        for (const a of this.apprenticeShelves) a.maxLength = value
        break
      case 'apprenticeSpeed':
        for (const a of this.apprenticeShelves) a.assemblyMs = value * 1000
        break
      case 'scribesBalance':
        this.autoMiner.setBalanceBlend(value)
        break
      case 'parallelPresses':
        this.syncApprenticeCount()
        break
    }
  }

  siphonLetter(key: string) {
    const shelfY = this.shelf.y / SCALE
    const preferUpper = this.shelf.letters.length === 0
    const lowerKey = key.toLowerCase()
    let bestPreferred: LetterBody | null = null
    let bestPreferredDist = Infinity
    let bestFallback: LetterBody | null = null
    let bestFallbackDist = Infinity

    for (const letter of this.letters) {
      if (letter.char.toLowerCase() !== lowerKey) continue
      const dist = Math.abs(letter.y - shelfY)
      const matchesPreferred = letter.isUpper === preferUpper
      if (matchesPreferred) {
        if (dist < bestPreferredDist) {
          bestPreferredDist = dist
          bestPreferred = letter
        }
      } else {
        if (dist < bestFallbackDist) {
          bestFallbackDist = dist
          bestFallback = letter
        }
      }
    }

    const best = bestPreferred ?? bestFallback
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

  /**
   * Alchemy: every 2s, rebalance the basin by moving letters from the largest
   * pile to the smallest. Each conversion picks the most-abundant letter as
   * victim and the least-abundant letter as recipient. N conversions per tick,
   * where N is the Alchemy upgrade tier; level 0 disables it.
   *
   * The local `counts` snapshot is mutated between iterations so that a batch
   * of N conversions spreads across several scarce letters instead of dumping
   * the whole batch into the single emptiest slot.
   */
  updateAlchemy(dt: number) {
    const conversions = getUpgradeValue('alchemy', this.upgradeLevels.alchemy)
    if (conversions <= 0) return
    this.alchemyTimer += dt
    if (this.alchemyTimer < 2) return
    this.alchemyTimer = 0

    const counts = new Map<string, number>()
    for (const letter of this.letters) {
      const c = letter.char.toLowerCase()
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }

    for (let n = 0; n < conversions; n++) {
      if (this.letters.length === 0) return

      // Most abundant → victim.
      let topChar: string | null = null
      let topCount = 0
      for (const [ch, count] of counts) {
        if (count > topCount) {
          topCount = count
          topChar = ch
        }
      }
      if (!topChar || topCount <= 0) return

      // Least abundant across a-z (excluding the victim) → recipient.
      // Ties are broken uniformly so repeated scarcest letters don't always
      // pick the alphabetically first one.
      let minCount = Infinity
      const leastCommon: string[] = []
      for (let i = 0; i < 26; i++) {
        const ch = String.fromCharCode(97 + i)
        if (ch === topChar) continue
        const c = counts.get(ch) ?? 0
        if (c < minCount) {
          minCount = c
          leastCommon.length = 0
          leastCommon.push(ch)
        } else if (c === minCount) {
          leastCommon.push(ch)
        }
      }
      if (leastCommon.length === 0) return
      const recipient = leastCommon[Math.floor(Math.random() * leastCommon.length)]!

      const victim = this.letters.find((l) => l.char.toLowerCase() === topChar)
      if (!victim) return

      this.physics.remove(victim.id)
      const idx = this.letters.indexOf(victim)
      if (idx >= 0) this.letters.splice(idx, 1)
      this.letterMap.delete(victim.id)
      this.foregroundLetters.delete(victim)
      this.renderer.removeSprite(victim)

      counts.set(topChar, topCount - 1)
      counts.set(recipient, (counts.get(recipient) ?? 0) + 1)

      const x = this.width * (0.1 + Math.random() * 0.8)
      const y = -30 - Math.random() * 40
      this.spawnLetter(recipient, x, y)
    }
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
      this.hud.showScore(score)
      console.log(
        `Submitted: ${result.word} -> +${score.finalInk} Ink`,
        score.bonuses.map((b) => b.label).join(', '),
      )
      if (this.unlockedUniques.has('subWordHarvest')) {
        this.harvestSubWords(normalized)
      }
      this.expandFamily(entry?.root ?? normalized)
      this.checkMilestones()
      this.renderShopUI()
      this.sound.playStamp()
    } else {
      this.dumpShelfLetters(result.letters)
      this.sound.playError()
    }
  }

  /**
   * Score every dictionary word that appears as a contiguous substring (length >= 4).
   * Each sub-word scores on its own merits — a repeat is a repeat whether or not it
   * happens to also be contained inside another sub-word of this submission.
   */
  private harvestSubWords(word: string) {
    const seen = new Set<string>([word])
    for (let start = 0; start < word.length; start++) {
      for (let end = start + 4; end <= word.length; end++) {
        const sub = word.substring(start, end)
        if (seen.has(sub)) continue
        seen.add(sub)
        const entry = this.dictionary[sub]
        if (!entry) continue
        const score = this.economy.scoreWord(sub, [], entry)
        this.hud.aggregateLastScore(score)
      }
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

  getLetterCount(): number {
    return this.letters.length + this.shelf.letters.length
  }

  /** Memoized word-ghost char lookup. Invalidates on shelf change; throttles on basin change. */
  private getGhostChars(): Set<string> {
    const now = performance.now()
    const word = this.shelf.currentWord()
    const maxSlots = this.shelf.maxSlots
    const sameShelf =
      this.ghostCache !== null &&
      this.ghostCache.word === word &&
      this.ghostCache.maxSlots === maxSlots
    if (sameShelf && now - this.lastGhostRefresh < 250) {
      return this.ghostCache!.chars
    }
    const basinCounts = new Map<string, number>()
    for (const letter of this.letters) {
      const c = letter.char.toLowerCase()
      basinCounts.set(c, (basinCounts.get(c) ?? 0) + 1)
    }
    const chars = this.shelf.getCompletionChars(basinCounts)
    this.ghostCache = { word, maxSlots, chars }
    this.lastGhostRefresh = now
    return chars
  }

  updateOverflow(dt: number) {
    const count = this.getLetterCount()
    const max = this.getBasinCapacity()

    if (this.isDraining) {
      this.drainTimer -= dt
      if (this.drainTimer <= 0) {
        this.isDraining = false
        this.overflowCountdown = 0
        this.drainTimer = 0
        this.restoreFloor()
      }
      return
    }

    if (count > max) {
      const wasTicking = this.overflowCountdown > 0
      if (this.overflowCountdown <= 0) {
        this.overflowCountdown = BASIN.countdownSec
      }
      const before = this.overflowCountdown
      this.overflowCountdown -= dt

      const now = performance.now()
      if (
        wasTicking &&
        this.overflowCountdown > 0 &&
        Math.floor(before) !== Math.floor(this.overflowCountdown) &&
        now - this.lastOverflowTick > 500
      ) {
        this.lastOverflowTick = now
        this.sound.playTick()
      }

      if (this.overflowCountdown <= 0) {
        this.isDraining = true
        this.overflowCountdown = 0
        this.drainTimer = BASIN.drainSec
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

  /**
   * Bake the overflow vignette to a texture at a reference intensity. Called on resize
   * and first overflow entry — NOT every frame. Per-frame intensity and pulse are
   * driven by `sprite.alpha` in {@link renderOverflowVignette}.
   */
  private bakeOverflowVignette() {
    const dpr = window.devicePixelRatio
    const w = this.width
    const h = this.height
    const oc = new OffscreenCanvas(w * dpr, h * dpr)
    const ctx = oc.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    // Bake at max intensity; per-frame tuning happens via sprite.alpha.
    const baseAlpha = 0.35
    const spread = 140

    const topGrad = ctx.createLinearGradient(0, 0, 0, spread)
    topGrad.addColorStop(0, `rgba(192, 57, 43, ${baseAlpha})`)
    topGrad.addColorStop(1, 'rgba(192, 57, 43, 0)')
    ctx.fillStyle = topGrad
    ctx.fillRect(0, 0, w, spread)

    const botGrad = ctx.createLinearGradient(0, h, 0, h - spread)
    botGrad.addColorStop(0, `rgba(192, 57, 43, ${baseAlpha})`)
    botGrad.addColorStop(1, 'rgba(192, 57, 43, 0)')
    ctx.fillStyle = botGrad
    ctx.fillRect(0, h - spread, w, spread)

    const leftGrad = ctx.createLinearGradient(0, 0, spread, 0)
    leftGrad.addColorStop(0, `rgba(192, 57, 43, ${baseAlpha * 0.6})`)
    leftGrad.addColorStop(1, 'rgba(192, 57, 43, 0)')
    ctx.fillStyle = leftGrad
    ctx.fillRect(0, 0, spread, h)

    const rightGrad = ctx.createLinearGradient(w, 0, w - spread, 0)
    rightGrad.addColorStop(0, `rgba(192, 57, 43, ${baseAlpha * 0.6})`)
    rightGrad.addColorStop(1, 'rgba(192, 57, 43, 0)')
    ctx.fillStyle = rightGrad
    ctx.fillRect(w - spread, 0, spread, h)

    const oldTex = this.vignetteSprite.texture
    if (oldTex !== Texture.EMPTY) oldTex.destroy(true)
    this.vignetteSprite.texture = Texture.from({
      resource: oc.transferToImageBitmap(),
      resolution: dpr,
    })
    this.vignetteBakedW = w
    this.vignetteBakedH = h
  }

  renderOverflowVignette() {
    const count = this.getLetterCount()
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

    if (this.vignetteBakedW !== this.width || this.vignetteBakedH !== this.height) {
      this.bakeOverflowVignette()
    }

    this.vignetteSprite.alpha = intensity
    this.vignetteSprite.visible = true
  }

  renderOverflowHUD() {
    const count = this.getLetterCount()
    const max = this.getBasinCapacity()
    const warnAt = Math.floor(max * BASIN.warnRatio)

    if (count < warnAt && !this.isDraining) {
      this.overflowContainer.visible = false
      this.overflowTopY = null
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
    this.overflowTopY = by

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

    this.overflowBarText.text = `${count.toLocaleString()} / ${max.toLocaleString()}`
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
    const rawFrameDt = now - this.lastTime
    const frameDt = Math.min(rawFrameDt / 1000, 0.1)
    this.lastTime = now

    this.perfMonitor.recordFrame(rawFrameDt)

    const updateStart = performance.now()
    this.autoMiner.update(frameDt)
    for (const a of this.apprenticeShelves) a.update(frameDt)
    this.updateAlchemy(frameDt)
    this.flushSpawnQueue()
    if (now - this.lastShopRefresh > 500) {
      this.lastShopRefresh = now
      this.renderShopUI()
      if (this.dictionaryOpen) this.renderDictionaryUI()
    }
    this.updateOverflow(frameDt)
    this.killOffscreen()
    this.perfMonitor.recordUpdate(performance.now() - updateStart)

    this.accumulator += frameDt
    let steps = 0
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.drag.applySpringForce()
      this.accumulator -= FIXED_DT
      steps++
    }
    if (steps >= MAX_SUBSTEPS) this.accumulator = 0

    const doRender = () => {
      const spriteStart = performance.now()
      this.render()
      const spriteEnd = performance.now()
      this.app.renderer.render(this.app.stage)
      const gpuEnd = performance.now()
      this.perfMonitor.recordSprite(spriteEnd - spriteStart)
      this.perfMonitor.recordGpu(gpuEnd - spriteEnd)
      this.perfMonitor.render()
    }

    if (steps > 0 && !this.waitingForStep) {
      this.waitingForStep = true
      let remaining = steps
      const stepOnce = () => {
        const stepStart = performance.now()
        this.physics.step((bodies) => {
          this.perfMonitor.recordPhysicsStep(performance.now() - stepStart)
          this.applyBodyStates(bodies)
          remaining--
          if (remaining > 0) {
            this.drag.applySpringForce()
            stepOnce()
          } else {
            this.waitingForStep = false
            doRender()
            requestAnimationFrame(this.loop)
          }
        })
      }
      stepOnce()
    } else {
      doRender()
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
    let t = performance.now()
    this.mining.render(this.width)
    this.perfMonitor.recordPhase('mining', performance.now() - t)

    t = performance.now()
    this.renderOverflowVignette()
    this.perfMonitor.recordPhase('vignette', performance.now() - t)

    t = performance.now()
    this.renderCensus()
    this.perfMonitor.recordPhase('census', performance.now() - t)

    const dragging = this.drag.getDragging()
    const hovered = this.drag.getHovered()
    const now = performance.now()

    for (const [letter, time] of this.foregroundLetters) {
      if (now - time > FOREGROUND_MS) this.foregroundLetters.delete(letter)
    }

    const ghostChars = this.unlockedUniques.has('wordGhost') ? this.getGhostChars() : null

    const getGlow = (letter: LetterBody): string | null => {
      const lc = letter.char.toLowerCase()
      if (ghostChars?.has(lc)) return '#2E8B7D'
      return null
    }

    t = performance.now()
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
    this.perfMonitor.recordPhase('letters', performance.now() - t)

    t = performance.now()
    this.shelf.render()
    this.perfMonitor.recordPhase('shelf', performance.now() - t)

    t = performance.now()
    this.renderOverflowHUD()
    this.perfMonitor.recordPhase('ovhud', performance.now() - t)

    t = performance.now()
    this.hud.render(this.width, this.height)
    this.perfMonitor.recordPhase('hud', performance.now() - t)

    t = performance.now()
    const BENCH_HEIGHT = 76
    const BENCH_GAP = 6
    const MIN_BENCH_TOP = MINING.firstLineY + MINING.lineHeight + 16
    let apprenticeAnchor =
      this.overflowTopY !== null ? this.overflowTopY - 8 : this.shelf.rect.y - 12
    for (const a of this.apprenticeShelves) {
      if (apprenticeAnchor - BENCH_HEIGHT < MIN_BENCH_TOP) {
        a.hide()
        continue
      }
      const rendered = a.render(apprenticeAnchor)
      if (rendered) apprenticeAnchor -= BENCH_HEIGHT + BENCH_GAP
    }
    this.perfMonitor.recordPhase('apprent', performance.now() - t)
  }
}

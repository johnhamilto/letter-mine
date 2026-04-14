/** Shared type definitions. */

export interface GlyphData {
  char: string
  convexParts: number[][]
  width: number
  height: number
  offsetX: number
  offsetY: number
}

export interface LetterBody {
  id: number
  glyph: GlyphData
  char: string
  isUpper: boolean
  renderScale: number
  x: number
  y: number
  rotation: number
}

// ── Physics Worker Protocol ──

export interface PhysicsInitMsg {
  type: 'init'
  gravity: number
  solverIterations: number
  pgsIterations: number
  contactFrequency: number
  predictionDistance: number
  allowedLinearError: number
  maxCcdSubsteps: number
  glyphs: Record<string, GlyphData>
  wallWidth: number
  wallHeight: number
}

export interface PhysicsSpawnMsg {
  type: 'spawn'
  id: number
  char: string
  x: number
  y: number
}

export interface PhysicsRemoveMsg {
  type: 'remove'
  id: number
}

export interface PhysicsSetLinvelMsg {
  type: 'setLinvel'
  id: number
  vx: number
  vy: number
}

export interface PhysicsSetAngvelMsg {
  type: 'setAngvel'
  id: number
  angvel: number
}

export interface PhysicsSetGravityScaleMsg {
  type: 'setGravityScale'
  id: number
  scale: number
}

export interface PhysicsWakeUpMsg {
  type: 'wakeUp'
  id: number
}

export interface PhysicsApplyImpulseMsg {
  type: 'applyImpulse'
  id: number
  ix: number
  iy: number
}

export interface PhysicsApplyTorqueImpulseMsg {
  type: 'applyTorqueImpulse'
  id: number
  torque: number
}

export interface PhysicsRebuildWallsMsg {
  type: 'rebuildWalls'
  width: number
  height: number
  isDraining: boolean
}

export interface PhysicsRemoveFloorMsg {
  type: 'removeFloor'
}

export interface PhysicsRestoreFloorMsg {
  type: 'restoreFloor'
  height: number
}

export interface PhysicsStepMsg {
  type: 'step'
}

export type PhysicsWorkerInMsg =
  | PhysicsInitMsg
  | PhysicsSpawnMsg
  | PhysicsRemoveMsg
  | PhysicsSetLinvelMsg
  | PhysicsSetAngvelMsg
  | PhysicsSetGravityScaleMsg
  | PhysicsWakeUpMsg
  | PhysicsApplyImpulseMsg
  | PhysicsApplyTorqueImpulseMsg
  | PhysicsRebuildWallsMsg
  | PhysicsRemoveFloorMsg
  | PhysicsRestoreFloorMsg
  | PhysicsStepMsg

export interface BodyState {
  id: number
  x: number
  y: number
  rotation: number
}

export interface PhysicsStepResultMsg {
  type: 'stepResult'
  bodies: BodyState[]
}

export interface PhysicsReadyMsg {
  type: 'ready'
}

export type PhysicsWorkerOutMsg = PhysicsStepResultMsg | PhysicsReadyMsg

export interface ShelfLetter {
  char: string
  isUpper: boolean
}

export type WordStatus = 'none' | 'prefix' | 'valid'

// ── Economy ──

export interface DictionaryEntry {
  freq: number
  tier: number // 0=legendary, 1=rare, 2=uncommon, 3=common, 4=universal
  root: string
  pos: string[]
  syl: number
  rhyme: string | null
}

export interface ScoreBonus {
  label: string
  multiplier: number
}

export interface ScoreResult {
  word: string
  baseValue: number
  tierMultiplier: number
  bonuses: ScoreBonus[]
  finalInk: number
  isRepeat: boolean
  isNewDiscovery: boolean
  isFirstInFamily: boolean
}

// ── Upgrades & Progression ──

export type UpgradeTrack =
  | 'basinCapacity'
  | 'shelfWidth'
  | 'apprenticeShelfWidth'
  | 'apprenticeSpeed'
  | 'miningQuality'
  | 'autoMiner'
  | 'inkMultiplier'
  | 'scribesBalance'
  | 'parallelPresses'

export type UniqueUpgrade =
  | 'wordCheck'
  | 'basinShake'
  | 'letterCount'
  | 'compositorsPick'
  | 'siphon'
  | 'wordGhost'
  | 'alchemy'
  | 'apprenticeShelf'
  | 'subWordHarvest'
  | 'overdrive'
  | 'autoDiscovery'
  | 'imprimatur'

export type MilestoneName =
  | 'apprentice'
  | 'journeyman'
  | 'wordsmith'
  | 'lexicographer'
  | 'publisher'
  | 'master'

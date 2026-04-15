/** Shared constants — single source of truth for the entire game. */

// ── Scale ──
// 100 pixels = 1 physics meter
export const SCALE = 100
export const LOWERCASE_SCALE = 0.6
export const UPPERCASE_SCALE = 1.0
export const GLYPH_TO_PHYSICS = 1 / SCALE

// ── Font ──
export const FONT_FAMILY = "'Playfair Display'"
export const PROMPT_FONT_SIZE = SCALE * LOWERCASE_SCALE
export const PROMPT_FONT = `bold ${PROMPT_FONT_SIZE}px ${FONT_FAMILY}`

// ── Colors ──
export const COLORS = {
  bg: '#F5F0E8',
  ink: '#2C2416',
  inkDark: '#1A1008',
  shelf: '#8B7355',
  shelfBg: '#EDE6D6',
  shelfDark: '#6B5A42',
  valid: '#6B4423',
  muted: '#9E8E76',
  faded: '#C4B69C',
  error: '#C0392B',
} as const

// ── Physics ──
export const PHYSICS = {
  gravity: 20.0,
  solverIterations: 8,
  pgsIterations: 2,
  contactFrequency: 20.0,
  predictionDistance: 0.01,
  allowedLinearError: 0.0005,
  maxCcdSubsteps: 4,
} as const

// ── Game loop ──
export const FIXED_DT = 1 / 60
export const MAX_SUBSTEPS = 3
export const FOREGROUND_MS = 4000

// ── Basin capacity ──
export const BASIN = {
  maxLetters: 500,
  warnRatio: 0.95, // start warning at 95%
  countdownSec: 5,
  drainSec: 2, // floor removed for this long, then restored
  killPlaneOffset: 300, // px below screen to despawn
} as const

// ── Drag ──
export const DRAG = {
  linearResponse: 20,
  angularResponse: 10,
  gravityScale: 0.1,
  slop: 5, // px before a click becomes a drag
} as const

// ── Mining prompt ──
export const MINING = {
  padX: 60,
  firstLineY: 120,
  lineHeight: 90,
  maxVisibleLines: 2,
  mineAnimMs: 180,
  mistakeAnimMs: 250,
} as const

// ── Shelf ──
export const SHELF = {
  yRatio: 0.4,
  margin: 60,
  height: 80,
  slotWidth: 48,
  slotGap: 6,
  borderWidth: 2,
  cornerRadius: 6,
  maxSlots: 12,
} as const

// ── Scoring ──
export const SCORING = {
  tierMultipliers: [15, 6, 3, 1.5, 1] as const, // indexed by tier 0-4
  baseScoreMultiplier: 1.5, // applied to baseValue (formerly the capped streak bonus)
  firstInFamilyBonus: 2,
  uppercaseOpenerBonus: 1.5,
  repeatWordPenalty: 0.1,
  letterMinedInk: 0.1,
  scoreFlashMs: 2000,
} as const

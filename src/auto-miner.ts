/** Auto-Miner — spawns frequency-weighted random letters when the player is idle. */

/** Approximate English letter frequencies (%). */
const LETTER_FREQ: ReadonlyArray<[string, number]> = [
  ['e', 12.7],
  ['t', 9.1],
  ['a', 8.2],
  ['o', 7.5],
  ['i', 7.0],
  ['n', 6.7],
  ['s', 6.3],
  ['h', 6.1],
  ['r', 6.0],
  ['d', 4.3],
  ['l', 4.0],
  ['c', 2.8],
  ['u', 2.8],
  ['m', 2.4],
  ['w', 2.4],
  ['f', 2.2],
  ['g', 2.0],
  ['y', 2.0],
  ['p', 1.9],
  ['b', 1.5],
  ['v', 1.0],
  ['k', 0.8],
  ['j', 0.15],
  ['x', 0.15],
  ['q', 0.1],
  ['z', 0.07],
]

const FREQ_TOTAL = LETTER_FREQ.reduce((acc, [, f]) => acc + f, 0)

export class AutoMiner {
  private onSpawn: (char: string) => void
  private getBasinCounts: () => Map<string, number>
  private accumulator = 0
  private balanceBlend = 0

  /** Characters per second. 0 = disabled. */
  rate = 0

  /** Return true to suppress spawning (e.g. basin near capacity). */
  shouldPause: () => boolean = () => false

  constructor(onSpawn: (char: string) => void, getBasinCounts: () => Map<string, number>) {
    this.onSpawn = onSpawn
    this.getBasinCounts = getBasinCounts
  }

  /** Scribe's Balance blend. 0 = pure English freq, 1 = pure scarcity-weighted. */
  setBalanceBlend(blend: number) {
    this.balanceBlend = Math.max(0, Math.min(1, blend))
  }

  private pickLetter(): string {
    const b = this.balanceBlend
    // Fast path: no scarcity bias, use static English frequency.
    if (b <= 0) {
      const r = Math.random() * FREQ_TOTAL
      let sum = 0
      for (const [char, freq] of LETTER_FREQ) {
        sum += freq
        if (r <= sum) return char
      }
      return 'e'
    }

    // Blend of normalized-English and normalized-scarcity weights.
    const counts = this.getBasinCounts()
    let scarcitySum = 0
    const scarcityRaw: number[] = new Array(LETTER_FREQ.length)
    for (let i = 0; i < LETTER_FREQ.length; i++) {
      const [char] = LETTER_FREQ[i]!
      const s = 1 / ((counts.get(char) ?? 0) + 1)
      scarcityRaw[i] = s
      scarcitySum += s
    }

    const r = Math.random()
    let sum = 0
    for (let i = 0; i < LETTER_FREQ.length; i++) {
      const [char, freq] = LETTER_FREQ[i]!
      const freqNorm = freq / FREQ_TOTAL
      const scarcityNorm = scarcityRaw[i]! / scarcitySum
      sum += freqNorm * (1 - b) + scarcityNorm * b
      if (r <= sum) return char
    }
    return 'e'
  }

  update(dt: number) {
    if (this.rate <= 0) return
    if (this.shouldPause()) {
      this.accumulator = 0
      return
    }

    this.accumulator += dt
    const interval = 1 / this.rate
    while (this.accumulator >= interval) {
      this.accumulator -= interval
      this.onSpawn(this.pickLetter())
    }
  }
}

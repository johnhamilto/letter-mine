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

const CDF: ReadonlyArray<{ char: string; cumulative: number }> = (() => {
  let sum = 0
  const total = LETTER_FREQ.reduce((acc, [, f]) => acc + f, 0)
  return LETTER_FREQ.map(([char, freq]) => {
    sum += freq / total
    return { char, cumulative: sum }
  })
})()

function pickLetter(): string {
  const r = Math.random()
  for (const entry of CDF) {
    if (r <= entry.cumulative) return entry.char
  }
  return 'e'
}

export class AutoMiner {
  private onSpawn: (char: string) => void
  private accumulator = 0

  /** Characters per second. 0 = disabled. */
  rate = 0

  /** Return true to suppress spawning (e.g. basin near capacity). */
  shouldPause: () => boolean = () => false

  constructor(onSpawn: (char: string) => void) {
    this.onSpawn = onSpawn
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
      this.onSpawn(pickLetter())
    }
  }
}

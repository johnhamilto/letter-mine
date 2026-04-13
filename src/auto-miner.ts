/** Auto-Miner — types automatically when the player is idle. */

import type { MiningPrompt } from './mining'

const IDLE_THRESHOLD_MS = 2000

export class AutoMiner {
  private mining: MiningPrompt
  private lastPlayerInput = performance.now()
  private accumulator = 0

  /** Characters per second. 0 = disabled. */
  rate = 0

  constructor(mining: MiningPrompt) {
    this.mining = mining
    window.addEventListener('keydown', () => {
      this.lastPlayerInput = performance.now()
    })
  }

  update(dt: number) {
    if (this.rate <= 0) return
    if (this.mining.paused) return

    const now = performance.now()
    if (now - this.lastPlayerInput < IDLE_THRESHOLD_MS) {
      this.accumulator = 0
      return
    }

    this.accumulator += dt
    const interval = 1 / this.rate
    while (this.accumulator >= interval) {
      this.accumulator -= interval
      this.mining.mineNext()
    }
  }
}

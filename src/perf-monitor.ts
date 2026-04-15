/** Perf HUD — FPS and phase timing breakdowns for pinpointing slowdowns. */

const SAMPLE_WINDOW = 60

interface Ring {
  samples: number[]
  idx: number
}

function ring(): Ring {
  return { samples: [], idx: 0 }
}

function push(r: Ring, v: number) {
  if (r.samples.length < SAMPLE_WINDOW) r.samples.push(v)
  else r.samples[r.idx] = v
  r.idx = (r.idx + 1) % SAMPLE_WINDOW
}

function avg(r: Ring): number {
  if (r.samples.length === 0) return 0
  let sum = 0
  for (const v of r.samples) sum += v
  return sum / r.samples.length
}

function max(r: Ring): number {
  let m = 0
  let seen = false
  for (const v of r.samples) {
    if (!seen || v > m) {
      m = v
      seen = true
    }
  }
  return m
}

export class PerfMonitor {
  private el: HTMLDivElement
  private frameTimes = ring()
  private updateTimes = ring()
  private physTimes = ring()
  private spriteTimes = ring()
  private gpuTimes = ring()
  private phaseTimes = new Map<string, Ring>()
  private phaseOrder: string[] = []
  private spikeCount = 0
  private lastRender = 0
  private _enabled = false
  private getLetterCount: () => number

  constructor(getLetterCount: () => number) {
    this.getLetterCount = getLetterCount
    this.el = document.createElement('div')
    this.el.className = 'perf-monitor'
    this.el.style.display = 'none'
    document.body.appendChild(this.el)
  }

  set enabled(v: boolean) {
    this._enabled = v
    this.el.style.display = v ? 'block' : 'none'
    if (!v) {
      this.frameTimes = ring()
      this.updateTimes = ring()
      this.physTimes = ring()
      this.spriteTimes = ring()
      this.gpuTimes = ring()
      this.phaseTimes.clear()
      this.phaseOrder = []
      this.spikeCount = 0
    }
  }

  get enabled(): boolean {
    return this._enabled
  }

  recordFrame(frameDtMs: number) {
    if (!this._enabled) return
    push(this.frameTimes, frameDtMs)
    if (frameDtMs > 20) this.spikeCount++
  }

  recordUpdate(ms: number) {
    if (this._enabled) push(this.updateTimes, ms)
  }

  recordPhysicsStep(ms: number) {
    if (this._enabled) push(this.physTimes, ms)
  }

  recordSprite(ms: number) {
    if (this._enabled) push(this.spriteTimes, ms)
  }

  recordGpu(ms: number) {
    if (this._enabled) push(this.gpuTimes, ms)
  }

  /** Record an arbitrary named phase time. Cheap: no allocations on the hot path. */
  recordPhase(name: string, ms: number) {
    if (!this._enabled) return
    let r = this.phaseTimes.get(name)
    if (!r) {
      r = ring()
      this.phaseTimes.set(name, r)
      this.phaseOrder.push(name)
    }
    push(r, ms)
  }

  render() {
    if (!this._enabled) return
    const now = performance.now()
    if (now - this.lastRender < 250) return
    this.lastRender = now

    const frameAvg = avg(this.frameTimes)
    const frameMax = max(this.frameTimes)
    const fps = frameAvg > 0 ? 1000 / frameAvg : 0

    const fmt = (r: Ring) => `${avg(r).toFixed(1).padStart(5)}`

    const memInfo = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    const heapMb = memInfo ? memInfo.usedJSHeapSize / 1024 / 1024 : null

    const rows: string[] = [
      `${fps.toFixed(0).padStart(3)} fps · ${frameAvg.toFixed(1)}ms (peak ${frameMax.toFixed(0)})`,
      `update ${fmt(this.updateTimes)} ms`,
      `phys   ${fmt(this.physTimes)} ms`,
      `sprite ${fmt(this.spriteTimes)} ms`,
      `gpu    ${fmt(this.gpuTimes)} ms`,
      `letters ${this.getLetterCount().toString().padStart(4)}${
        heapMb !== null ? ` · ${heapMb.toFixed(0)}MB heap` : ''
      }`,
      `spikes ${this.spikeCount} (>20ms)`,
    ]
    if (this.phaseOrder.length > 0) {
      rows.push('─── phases ───')
      let maxNameLen = 0
      for (const name of this.phaseOrder) {
        if (name.length > maxNameLen) maxNameLen = name.length
      }
      for (const name of this.phaseOrder) {
        const r = this.phaseTimes.get(name)!
        rows.push(`${name.padEnd(maxNameLen)}  ${fmt(r)} ms`)
      }
    }
    this.el.textContent = rows.join('\n')
  }
}

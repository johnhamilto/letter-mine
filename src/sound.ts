/**
 * Lightweight sound manager using the Web Audio API.
 * Lazy AudioContext init (browser requires user gesture).
 * Fire-and-forget playback -- never blocks the game loop.
 */

const KEY_VARIANTS = 5

export class SoundManager {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private loading = new Map<string, Promise<void>>()
  muted = false

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
    return this.ctx
  }

  async load(name: string, url: string): Promise<void> {
    if (this.buffers.has(name)) return

    const existing = this.loading.get(name)
    if (existing) return existing

    const promise = fetch(url)
      .then((resp) => {
        if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`)
        return resp.arrayBuffer()
      })
      .then((data) => {
        const ctx = this.ensureContext()
        return ctx.decodeAudioData(data)
      })
      .then((buffer) => {
        this.buffers.set(name, buffer)
      })
      .catch((err) => {
        console.warn(`SoundManager: failed to load "${name}" from ${url}:`, err)
      })
      .finally(() => {
        this.loading.delete(name)
      })

    this.loading.set(name, promise)
    return promise
  }

  play(name: string, options?: { volume?: number; pitchVariation?: number }): void {
    if (this.muted) return
    const buffer = this.buffers.get(name)
    if (!buffer) return

    const ctx = this.ensureContext()
    const source = ctx.createBufferSource()
    source.buffer = buffer

    const gain = ctx.createGain()
    gain.gain.value = options?.volume ?? 1.0
    source.connect(gain)
    gain.connect(ctx.destination)

    if (options?.pitchVariation) {
      const variation = options.pitchVariation
      source.playbackRate.value = 1 + (Math.random() * 2 - 1) * variation
    }

    source.start()
  }

  playRandom(
    prefix: string,
    count: number,
    options?: { volume?: number; pitchVariation?: number },
  ): void {
    const idx = Math.floor(Math.random() * count) + 1
    this.play(`${prefix}${idx}`, options)
  }

  playKeyClick(): void {
    this.playRandom('key', KEY_VARIANTS, { volume: 0.4, pitchVariation: 0.08 })
  }

  playShelfSnap(): void {
    this.play('shelf-snap', { volume: 0.5 })
  }

  playStamp(): void {
    this.play('stamp', { volume: 0.7 })
  }

  playError(): void {
    this.play('error', { volume: 0.4 })
  }

  playTick(): void {
    this.play('tick', { volume: 0.3, pitchVariation: 0.05 })
  }

  async loadAll(base: string): Promise<void> {
    const loads: Promise<void>[] = []
    for (let i = 1; i <= KEY_VARIANTS; i++) {
      loads.push(this.load(`key${i}`, `${base}sounds/key${i}.mp3`))
    }
    loads.push(this.load('shelf-snap', `${base}sounds/shelf-snap.mp3`))
    loads.push(this.load('stamp', `${base}sounds/stamp.mp3`))
    loads.push(this.load('error', `${base}sounds/error.mp3`))
    loads.push(this.load('tick', `${base}sounds/tick.mp3`))
    await Promise.all(loads)
  }
}

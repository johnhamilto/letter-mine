export interface Track {
  src: string
  title: string
  artist: string
}

const PLAYLIST: ReadonlyArray<Track> = [
  { src: 'music/beautiful-dreamer.mp3', title: 'Beautiful Dreamer', artist: 'Amy Rowe' },
  { src: 'music/belladonna-for-two.mp3', title: 'Belladonna For Two', artist: 'Martin Landstrom' },
  { src: 'music/breathe-and-begin.mp3', title: 'Breathe and Begin', artist: 'Daniel Fridell' },
  {
    src: 'music/every-hour-of-the-night.mp3',
    title: 'Every Hour of the Night',
    artist: 'Martin Landstrom',
  },
  {
    src: 'music/lovely-you-and-lucky-me.mp3',
    title: 'Lovely You and Lucky Me',
    artist: 'Martin Landstrom',
  },
]

const CROSSFADE_MS = 3000
const FADE_IN_MS = 1200
const FADE_OUT_MS = 600

interface FadeJob {
  el: HTMLAudioElement
  startTime: number
  duration: number
  from: number
  to: number
}

export class MusicPlayer {
  private playlist: Track[]
  private primary: HTMLAudioElement
  private secondary: HTMLAudioElement
  private activeEl: HTMLAudioElement
  private pendingEl: HTMLAudioElement

  private queue: number[] = []
  private queuePos = 0

  private volume: number
  private enabled: boolean
  private started = false
  private crossfading = false
  private rafId = 0
  private fades = new Map<HTMLAudioElement, FadeJob>()

  onTrackChange: ((track: Track) => void) | null = null

  constructor(options: { volume: number; enabled: boolean; baseUrl: string }) {
    this.playlist = PLAYLIST.map((t) => ({ ...t, src: `${options.baseUrl}${t.src}` }))
    this.volume = clamp01(options.volume)
    this.enabled = options.enabled
    this.primary = this.makeAudio()
    this.secondary = this.makeAudio()
    this.activeEl = this.primary
    this.pendingEl = this.secondary
    this.reshuffleQueue()
  }

  private makeAudio(): HTMLAudioElement {
    const el = new Audio()
    el.preload = 'auto'
    el.volume = 0
    return el
  }

  private reshuffleQueue() {
    const indices = this.playlist.map((_, i) => i)
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = indices[i]
      const other = indices[j]
      if (tmp !== undefined && other !== undefined) {
        indices[i] = other
        indices[j] = tmp
      }
    }
    this.queue = indices
    this.queuePos = 0
  }

  private takeNextTrack(): Track | null {
    if (this.playlist.length === 0) return null
    if (this.queuePos >= this.queue.length) this.reshuffleQueue()
    const idx = this.queue[this.queuePos++]
    if (idx === undefined) return null
    return this.playlist[idx] ?? null
  }

  /** Begin playback. Safe to call repeatedly (first call wins until stopped). */
  async start() {
    if (this.started || !this.enabled) return
    const track = this.takeNextTrack()
    if (!track) return
    this.started = true
    await this.playOn(this.activeEl, track, FADE_IN_MS)
    this.tick()
  }

  private async playOn(el: HTMLAudioElement, track: Track, fadeMs: number): Promise<boolean> {
    el.src = track.src
    el.currentTime = 0
    el.volume = 0
    try {
      await el.play()
    } catch {
      this.started = false
      return false
    }
    this.onTrackChange?.(track)
    this.fadeTo(el, this.volume, fadeMs)
    return true
  }

  private fadeTo(el: HTMLAudioElement, to: number, duration: number) {
    this.fades.set(el, { el, startTime: performance.now(), duration, from: el.volume, to })
  }

  private stepFades(now: number) {
    for (const [el, job] of this.fades) {
      const t = job.duration <= 0 ? 1 : Math.min(1, (now - job.startTime) / job.duration)
      el.volume = job.from + (job.to - job.from) * t
      if (t >= 1) this.fades.delete(el)
    }
  }

  private tick = () => {
    const now = performance.now()
    this.stepFades(now)

    if (this.started && this.enabled && !this.crossfading) {
      const el = this.activeEl
      const dur = el.duration
      if (Number.isFinite(dur) && dur > 0) {
        const timeLeft = dur - el.currentTime
        if (timeLeft < CROSSFADE_MS / 1000) this.beginCrossfade()
      }
    }

    if (this.started || this.fades.size > 0) {
      this.rafId = requestAnimationFrame(this.tick)
    } else {
      this.rafId = 0
    }
  }

  private async beginCrossfade() {
    const track = this.takeNextTrack()
    if (!track) return
    this.crossfading = true

    const fromEl = this.activeEl
    const toEl = this.pendingEl
    const ok = await this.playOn(toEl, track, CROSSFADE_MS)
    if (!ok) {
      this.crossfading = false
      return
    }

    this.activeEl = toEl
    this.pendingEl = fromEl

    this.fadeTo(fromEl, 0, CROSSFADE_MS)
    window.setTimeout(() => {
      fromEl.pause()
      fromEl.currentTime = 0
      this.crossfading = false
    }, CROSSFADE_MS + 100)
  }

  setVolume(v: number) {
    this.volume = clamp01(v)
    if (!this.enabled) return
    // If not currently fading, apply immediately. Otherwise let the fade finish.
    if (!this.fades.has(this.activeEl)) this.activeEl.volume = this.volume
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return
    this.enabled = enabled
    if (!enabled) {
      this.fadeTo(this.activeEl, 0, FADE_OUT_MS)
      if (this.crossfading) this.fadeTo(this.pendingEl, 0, FADE_OUT_MS)
      window.setTimeout(() => {
        this.primary.pause()
        this.secondary.pause()
      }, FADE_OUT_MS + 50)
      return
    }
    if (!this.started) {
      this.start()
      return
    }
    this.activeEl.play().catch(() => {})
    this.fadeTo(this.activeEl, this.volume, FADE_IN_MS)
    if (this.rafId === 0) this.tick()
  }

  pause() {
    this.activeEl.pause()
    this.secondary.pause()
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  resume() {
    if (!this.enabled || !this.started) return
    this.activeEl.play().catch(() => {})
    if (this.rafId === 0) this.tick()
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

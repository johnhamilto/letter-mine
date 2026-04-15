import type { Track } from './music'

const VISIBLE_MS = 5000

let root: HTMLDivElement | null = null
let titleEl: HTMLDivElement | null = null
let artistEl: HTMLDivElement | null = null
let hideTimer = 0

function ensureMounted() {
  if (root) return
  root = document.createElement('div')
  root.id = 'now-playing'
  root.className = 'now-playing'

  const label = document.createElement('div')
  label.className = 'np-label'
  label.textContent = 'Now Playing'

  titleEl = document.createElement('div')
  titleEl.className = 'np-title'

  artistEl = document.createElement('div')
  artistEl.className = 'np-artist'

  root.appendChild(label)
  root.appendChild(titleEl)
  root.appendChild(artistEl)
  document.body.appendChild(root)
}

export function showNowPlaying(track: Track) {
  ensureMounted()
  if (!root || !titleEl || !artistEl) return
  titleEl.textContent = track.title
  artistEl.textContent = track.artist
  root.classList.add('visible')
  if (hideTimer) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    root?.classList.remove('visible')
  }, VISIBLE_MS)
}

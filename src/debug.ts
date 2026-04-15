/** Dev panel — debug controls, only created in development mode. */

import { COLORS, FONT_FAMILY } from './constants'

export interface DevPanelCallbacks {
  onToggleGlyphs: () => boolean
  onSpawnLetters: (count: number) => void
  onAddInk: (amount: number) => void
  onDiscoverWords: (count: number) => void
  onClearDiscoveries: () => void
  onResetState: () => void
  onForceSave: () => void
  getStats: () => {
    ink: number
    totalInk: number
    discovered: number
    letters: number
  }
}

export function createDevPanel(callbacks: DevPanelCallbacks): HTMLDivElement {
  const root = document.createElement('div')
  root.style.cssText = `
    position:fixed;top:12px;right:90px;z-index:100;
    font-family:${FONT_FAMILY},serif;font-size:13px;
  `

  // Toggle button
  const toggle = document.createElement('button')
  toggle.textContent = 'DEV'
  toggle.style.cssText = `
    display:block;margin-left:auto;
    font-family:${FONT_FAMILY},serif;font-size:11px;font-weight:bold;
    padding:4px 10px;border:1.5px solid ${COLORS.shelf};border-radius:4px;
    cursor:pointer;background:${COLORS.valid};color:${COLORS.bg};
    letter-spacing:1px;
  `

  // Panel body
  const panel = document.createElement('div')
  panel.style.cssText = `
    display:none;margin-top:6px;
    background:rgba(245,240,232,0.96);border:1.5px solid ${COLORS.shelf};
    border-radius:6px;padding:12px;min-width:220px;
    box-shadow:0 4px 12px rgba(0,0,0,0.15);
  `

  let open = false
  toggle.addEventListener('click', () => {
    open = !open
    panel.style.display = open ? 'block' : 'none'
    toggle.style.background = open ? COLORS.ink : COLORS.valid
  })

  // ── Stats ──
  const statsEl = document.createElement('div')
  statsEl.style.cssText = `
    font-size:11px;color:${COLORS.muted};margin-bottom:10px;
    line-height:1.6;font-variant-numeric:tabular-nums;
  `
  panel.appendChild(statsEl)

  const updateStats = () => {
    if (!open) return
    const s = callbacks.getStats()
    statsEl.innerHTML = [
      `Ink: <b>${Math.floor(s.ink)}</b> (total: ${Math.floor(s.totalInk)})`,
      `Words: <b>${s.discovered}</b> | Letters: <b>${s.letters}</b>`,
    ].join('<br>')
  }
  setInterval(updateStats, 500)

  // ── Helpers ──

  const addSection = (label: string): HTMLDivElement => {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'margin-bottom:10px;'
    const title = document.createElement('div')
    title.textContent = label
    title.style.cssText = `
      font-size:10px;text-transform:uppercase;letter-spacing:1px;
      color:${COLORS.muted};margin-bottom:4px;font-weight:bold;
    `
    wrap.appendChild(title)
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;'
    wrap.appendChild(row)
    panel.appendChild(wrap)
    return row
  }

  const BTN = `
    font-family:${FONT_FAMILY},serif;font-size:12px;
    padding:4px 10px;border:1px solid ${COLORS.shelf};border-radius:3px;
    cursor:pointer;background:${COLORS.bg};color:${COLORS.ink};
  `

  const addButton = (
    parent: HTMLDivElement,
    label: string,
    onClick: () => void,
    style?: string,
  ) => {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.style.cssText = style ?? BTN
    btn.addEventListener('click', onClick)
    parent.appendChild(btn)
    return btn
  }

  const addToggle = (
    parent: HTMLDivElement,
    label: string,
    active: boolean,
    onToggle: () => boolean,
  ) => {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.style.cssText = BTN
    const apply = (a: boolean) => {
      btn.style.background = a ? COLORS.ink : COLORS.bg
      btn.style.color = a ? COLORS.bg : COLORS.ink
    }
    apply(active)
    btn.addEventListener('click', () => apply(onToggle()))
    parent.appendChild(btn)
    return btn
  }

  const accentStyle = `${BTN}background:${COLORS.valid};color:${COLORS.bg};border-color:${COLORS.valid};`
  const dangerStyle = `${BTN}background:${COLORS.error};color:${COLORS.bg};border-color:${COLORS.error};`

  // ── Rendering ──
  const renderRow = addSection('Rendering')
  addToggle(renderRow, 'Glyphs', true, callbacks.onToggleGlyphs)

  // ── Spawn ──
  const spawnRow = addSection('Spawn Letters')
  for (const n of [10, 50, 100, 500]) {
    addButton(spawnRow, `+${n}`, () => callbacks.onSpawnLetters(n), accentStyle)
  }

  // ── Ink ──
  const inkRow = addSection('Ink')
  for (const n of [100, 1_000, 10_000]) {
    const label = n >= 1000 ? `+${n / 1000}k` : `+${n}`
    addButton(inkRow, label, () => callbacks.onAddInk(n))
  }

  // ── Words ──
  const wordRow = addSection('Discover Words')
  for (const n of [10, 50, 100, 500]) {
    addButton(wordRow, `+${n}`, () => callbacks.onDiscoverWords(n))
  }
  addButton(wordRow, 'Clear', callbacks.onClearDiscoveries, dangerStyle)

  // ── State ──
  const stateRow = addSection('State')
  addButton(stateRow, 'Save', callbacks.onForceSave)
  addButton(
    stateRow,
    'Reset All',
    () => {
      if (confirm('Reset all progress? This cannot be undone.')) {
        callbacks.onResetState()
      }
    },
    dangerStyle,
  )

  root.appendChild(toggle)
  root.appendChild(panel)
  document.body.appendChild(root)
  return root
}

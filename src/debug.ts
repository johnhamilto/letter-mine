/** Debug UI — toggle buttons for glyphs, colliders, and test spawning. */

import { COLORS, FONT_FAMILY } from "./constants"

interface DebugCallbacks {
  onToggleGlyphs: () => boolean
  onToggleColliders: () => boolean
  onSpawn100: () => void
}

export function createDebugUI(callbacks: DebugCallbacks): HTMLDivElement {
  const container = document.createElement("div")
  container.style.cssText =
    "position:fixed;top:12px;right:12px;display:flex;gap:8px;z-index:10"

  const makeBtn = (label: string, active: boolean, toggle: () => boolean) => {
    const btn = document.createElement("button")
    btn.textContent = label
    btn.style.cssText = `
      font-family:${FONT_FAMILY},serif;font-size:14px;
      padding:6px 14px;border:1.5px solid ${COLORS.shelf};border-radius:4px;
      cursor:pointer;transition:all 0.15s;
      background:${active ? COLORS.ink : COLORS.bg};
      color:${active ? COLORS.bg : COLORS.ink};
    `
    btn.addEventListener("click", () => {
      const nowActive = toggle()
      btn.style.background = nowActive ? COLORS.ink : COLORS.bg
      btn.style.color = nowActive ? COLORS.bg : COLORS.ink
    })
    return btn
  }

  container.appendChild(makeBtn("Glyphs", true, callbacks.onToggleGlyphs))
  container.appendChild(
    makeBtn("Colliders", false, callbacks.onToggleColliders),
  )

  const spawnBtn = document.createElement("button")
  spawnBtn.textContent = "Spawn 100"
  spawnBtn.style.cssText = `
    font-family:${FONT_FAMILY},serif;font-size:14px;
    padding:6px 14px;border:1.5px solid ${COLORS.shelf};border-radius:4px;
    cursor:pointer;background:${COLORS.valid};color:${COLORS.bg};
  `
  spawnBtn.addEventListener("click", callbacks.onSpawn100)
  container.appendChild(spawnBtn)

  document.body.appendChild(container)
  return container
}

import { Application } from 'pixi.js'
import { PhysicsProxy } from './physics'
import { Game } from './game'
import type { GlyphData } from './types'

declare global {
  interface Window {
    __game?: Game
    __error?: string
  }
}

async function main() {
  const base = import.meta.env.BASE_URL

  await (async () => {
    const font = new FontFace('Playfair Display', `url(${base}fonts/PlayfairDisplay.ttf)`)
    await font.load()
    document.fonts.add(font)
  })()

  const glyphData = (await fetch(`${base}glyphs.json`).then((r) => r.json())) as Record<
    string,
    GlyphData
  >

  const app = new Application()
  await app.init({
    width: window.innerWidth,
    height: window.innerHeight,
    background: 0xf5f0e8,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio,
  })

  app.ticker.stop()
  app.ticker.autoStart = false

  const container = document.getElementById('game')
  if (!container) throw new Error('No #game container')
  container.appendChild(app.canvas)

  const physics = new PhysicsProxy()
  await physics.init(glyphData, window.innerWidth, window.innerHeight)

  const game = new Game(app, physics, glyphData)
  window.__game = game
  game.start()
}

main().catch((err) => {
  window.__error = String(err)
  console.error(err)
})

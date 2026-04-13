import RAPIER from '@dimforge/rapier2d-compat'
import { Application } from 'pixi.js'
import { Game } from './game'

async function main() {
  const base = import.meta.env.BASE_URL

  await Promise.all([
    RAPIER.init(),
    (async () => {
      const font = new FontFace('Playfair Display', `url(${base}fonts/PlayfairDisplay.ttf)`)
      await font.load()
      document.fonts.add(font)
    })(),
  ])

  const glyphData = await fetch(`${base}glyphs.json`).then((r) => r.json())

  const app = new Application()
  await app.init({
    width: window.innerWidth,
    height: window.innerHeight,
    background: 0xf5f0e8,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio,
  })

  // Disable PixiJS ticker — we drive rendering from our own rAF loop
  app.ticker.stop()
  app.ticker.autoStart = false

  const container = document.getElementById('game')
  if (!container) throw new Error('No #game container')
  container.appendChild(app.canvas)

  const game = new Game(app, RAPIER, glyphData)
  ;(window as unknown as Record<string, unknown>).__game = game
  game.start()
}

main().catch((err) => {
  ;(window as unknown as Record<string, unknown>).__error = String(err)
  console.error(err)
})

import RAPIER from '@dimforge/rapier2d-compat'
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

  const canvas = document.getElementById('game') as HTMLCanvasElement
  const game = new Game(canvas, RAPIER, glyphData)
  ;(window as unknown as Record<string, unknown>).__game = game
  game.start()
}

main().catch((err) => {
  ;(window as unknown as Record<string, unknown>).__error = String(err)
  console.error(err)
})

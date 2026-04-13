import { PhysicsProxy } from './physics'
import { Game } from './game'

async function main() {
  const base = import.meta.env.BASE_URL

  await (async () => {
    const font = new FontFace('Playfair Display', `url(${base}fonts/PlayfairDisplay.ttf)`)
    await font.load()
    document.fonts.add(font)
  })()

  const glyphData = await fetch(`${base}glyphs.json`).then((r) => r.json())

  const canvas = document.getElementById('game') as HTMLCanvasElement

  const physics = new PhysicsProxy()
  await physics.init(glyphData, window.innerWidth, window.innerHeight)

  const game = new Game(canvas, physics, glyphData)
  ;(window as unknown as Record<string, unknown>).__game = game
  game.start()
}

main().catch((err) => {
  ;(window as unknown as Record<string, unknown>).__error = String(err)
  console.error(err)
})

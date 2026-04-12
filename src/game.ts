import type RAPIER_NS from "@dimforge/rapier2d-compat"
import { type LetterBody, createLetterBody } from "./physics"

// Physics scale: how many pixels per physics meter
const SCALE = 100

// Colors
const COLORS = {
  bg: "#F5F0E8",
  ink: "#2C2416",
  inkDark: "#1A1008",
  shelf: "#8B7355",
  muted: "#9E8E76",
  faded: "#C4B69C",
  valid: "#6B4423",
}

interface GlyphData {
  char: string
  convexParts: number[][]
  width: number
  height: number
  offsetX: number
  offsetY: number
}

export class Game {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  RAPIER: typeof RAPIER_NS
  glyphs: Record<string, GlyphData>
  world: RAPIER_NS.World
  letters: LetterBody[] = []
  width = 0
  height = 0
  showGlyphs = true
  showColliders = false
  wallBodies: RAPIER_NS.RigidBody[] = []

  constructor(
    canvas: HTMLCanvasElement,
    RAPIER: typeof RAPIER_NS,
    glyphs: Record<string, GlyphData>,
  ) {
    this.canvas = canvas
    this.RAPIER = RAPIER
    this.glyphs = glyphs

    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("No 2d context")
    this.ctx = ctx

    // Create physics world with gravity
    this.world = new RAPIER.World(new RAPIER.Vector2(0, 9.81))
    this.world.numSolverIterations = 8
    this.world.maxCcdSubsteps = 4

    this.resize()
    window.addEventListener("resize", () => this.resize())
    this.createDebugUI()
  }

  createDebugUI() {
    const container = document.createElement("div")
    container.style.cssText = "position:fixed;top:12px;right:12px;display:flex;gap:8px;z-index:10"

    const makeBtn = (label: string, active: boolean, toggle: () => boolean) => {
      const btn = document.createElement("button")
      btn.textContent = label
      btn.style.cssText = `
        font-family:'Playfair Display',serif;font-size:14px;
        padding:6px 14px;border:1.5px solid #8B7355;border-radius:4px;
        cursor:pointer;transition:all 0.15s;
        background:${active ? "#2C2416" : "#F5F0E8"};
        color:${active ? "#F5F0E8" : "#2C2416"};
      `
      btn.addEventListener("click", () => {
        const nowActive = toggle()
        btn.style.background = nowActive ? "#2C2416" : "#F5F0E8"
        btn.style.color = nowActive ? "#F5F0E8" : "#2C2416"
      })
      return btn
    }

    container.appendChild(makeBtn("Glyphs", this.showGlyphs, () => {
      this.showGlyphs = !this.showGlyphs
      return this.showGlyphs
    }))
    container.appendChild(makeBtn("Colliders", this.showColliders, () => {
      this.showColliders = !this.showColliders
      return this.showColliders
    }))

    document.body.appendChild(container)
  }

  resize() {
    const dpr = window.devicePixelRatio
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.canvas.width = this.width * dpr
    this.canvas.height = this.height * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Rebuild walls
    this.buildWalls()
  }

  buildWalls() {
    const R = this.RAPIER
    // Remove old walls
    for (const body of this.wallBodies) {
      this.world.removeRigidBody(body)
    }
    this.wallBodies = []

    const w = this.width / SCALE
    const h = this.height / SCALE
    const thickness = 0.2

    // Floor
    const floorBody = this.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(w / 2, h)
    )
    this.world.createCollider(
      R.ColliderDesc.cuboid(w / 2, thickness),
      floorBody
    )
    this.wallBodies.push(floorBody)

    // Left wall
    const leftBody = this.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(0, h / 2)
    )
    this.world.createCollider(
      R.ColliderDesc.cuboid(thickness, h / 2),
      leftBody
    )
    this.wallBodies.push(leftBody)

    // Right wall
    const rightBody = this.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(w, h / 2)
    )
    this.world.createCollider(
      R.ColliderDesc.cuboid(thickness, h / 2),
      rightBody
    )
    this.wallBodies.push(rightBody)
  }

  spawnLetter(char: string, x: number, y: number) {
    const glyph = this.glyphs[char]
    if (!glyph) return

    const letter = createLetterBody(
      this.RAPIER,
      this.world,
      glyph,
      x / SCALE,
      y / SCALE,
    )
    if (letter) {
      this.letters.push(letter)
    }
  }

  start() {
    // Spawn some test letters
    const testWord = "LetterMine"
    for (let i = 0; i < testWord.length; i++) {
      const char = testWord[i]!
      const x = 200 + i * 60 + (Math.random() - 0.5) * 40
      const y = 50 + Math.random() * 100
      setTimeout(() => this.spawnLetter(char, x, y), i * 200)
    }

    this.loop()
  }

  loop = () => {
    this.world.step()
    this.render()
    requestAnimationFrame(this.loop)
  }

  render() {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.width, this.height)

    // Background
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, this.width, this.height)

    // Draw letters
    for (const letter of this.letters) {
      const pos = letter.body.translation()
      const rot = letter.body.rotation()
      const glyph = letter.glyph
      const scale = letter.renderScale

      ctx.save()
      ctx.translate(pos.x * SCALE, pos.y * SCALE)
      ctx.rotate(rot)

      // Draw the character aligned with the physics body.
      //
      // Physics body center = bounding box center in glyph coordinates.
      // opentype.js getPath(char, 0, 0, fontSize): baseline at y=0, origin at x=0.
      // Bounding box: (offsetX, offsetY) to (offsetX+width, offsetY+height).
      // BB center in glyph origin coords: (offsetX + width/2, offsetY + height/2).
      //
      // fillText(char, 0, 0) with baseline="alphabetic", align="left" draws at
      // the same origin as opentype's getPath(char, 0, 0, fontSize).
      //
      // So to put the BB center at canvas (0,0) [the physics body position],
      // we draw at: -(bbCenter) scaled to render size.
      if (this.showGlyphs) {
        const isUpper = glyph.char === glyph.char.toUpperCase()
        ctx.fillStyle = isUpper ? COLORS.inkDark : COLORS.ink

        const fontSize = SCALE * scale
        ctx.font = `bold ${fontSize}px 'Playfair Display'`
        ctx.textBaseline = "alphabetic"
        ctx.textAlign = "left"

        const s = fontSize / 100
        ctx.fillText(glyph.char, -(glyph.offsetX + glyph.width / 2) * s, -(glyph.offsetY + glyph.height / 2) * s)
      }

      if (this.showColliders) {
        const numColliders = letter.body.numColliders()
        for (let c = 0; c < numColliders; c++) {
          const collider = letter.body.collider(c)
          const verts = collider.vertices()
          if (verts && verts.length >= 4) {
            // Vertices are in local body space already (relative to body origin)
            ctx.strokeStyle = "rgba(220, 40, 40, 0.7)"
            ctx.lineWidth = 1.5 / scale
            ctx.beginPath()
            // Convert from physics units to pre-scale pixel space
            // Physics body is at (0,0) in this transformed context
            // Vertices are in physics-local coords, need to scale to pixels
            ctx.moveTo(verts[0]! * SCALE, verts[1]! * SCALE)
            for (let i = 2; i < verts.length; i += 2) {
              ctx.lineTo(verts[i]! * SCALE, verts[i + 1]! * SCALE)
            }
            ctx.closePath()
            ctx.stroke()
          }
        }
      }

      ctx.restore()
    }
  }
}

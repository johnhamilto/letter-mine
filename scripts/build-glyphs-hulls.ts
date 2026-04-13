/**
 * Build glyph data with one convex hull per contour.
 * Maximum performance (1-2 colliders/letter), minimum fidelity.
 *
 * Pipeline: Font file → bezier sampling → 1 convex hull per contour → JSON
 */

import opentype from "opentype.js"
import RAPIER from "@dimforge/rapier2d-compat"

const FONT_PATH = `${import.meta.dir}/../public/fonts/PlayfairDisplay.ttf`
const OUTPUT_PATH = `${import.meta.dir}/../dist/glyphs.json`

// High resolution for smooth convex hulls — Rapier reduces to minimal
// hull vertices anyway, so more sample points = better curve approximation.
const BEZIER_RESOLUTION = 16
const FONT_SIZE = 100
const MIN_CONTOUR_AREA = 1

interface Vec2 {
  x: number
  y: number
}

interface GlyphData {
  char: string
  convexParts: number[][]
  width: number
  height: number
  offsetX: number
  offsetY: number
}

// ── Bezier sampling ──

function sampleQuadratic(p0: Vec2, p1: Vec2, p2: Vec2, steps: number): Vec2[] {
  const points: Vec2[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    points.push({
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    })
  }
  return points
}

function sampleCubic(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  steps: number,
): Vec2[] {
  const points: Vec2[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    points.push({
      x:
        mt * mt * mt * p0.x +
        3 * mt * mt * t * p1.x +
        3 * mt * t * t * p2.x +
        t * t * t * p3.x,
      y:
        mt * mt * mt * p0.y +
        3 * mt * mt * t * p1.y +
        3 * mt * t * t * p2.y +
        t * t * t * p3.y,
    })
  }
  return points
}

// ── Path to contours ──

function pathToContours(path: opentype.Path): Vec2[][] {
  const contours: Vec2[][] = []
  let current: Vec2[] = []
  let cursor: Vec2 = { x: 0, y: 0 }

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case "M":
        if (current.length >= 3) contours.push(current)
        current = [{ x: cmd.x, y: cmd.y }]
        cursor = { x: cmd.x, y: cmd.y }
        break
      case "L":
        current.push({ x: cmd.x, y: cmd.y })
        cursor = { x: cmd.x, y: cmd.y }
        break
      case "Q":
        current.push(
          ...sampleQuadratic(
            cursor,
            { x: cmd.x1, y: cmd.y1 },
            { x: cmd.x, y: cmd.y },
            BEZIER_RESOLUTION,
          ),
        )
        cursor = { x: cmd.x, y: cmd.y }
        break
      case "C":
        current.push(
          ...sampleCubic(
            cursor,
            { x: cmd.x1, y: cmd.y1 },
            { x: cmd.x2, y: cmd.y2 },
            { x: cmd.x, y: cmd.y },
            BEZIER_RESOLUTION,
          ),
        )
        cursor = { x: cmd.x, y: cmd.y }
        break
      case "Z":
        if (current.length >= 3) contours.push(current)
        current = []
        break
    }
  }
  if (current.length >= 3) contours.push(current)
  return contours
}

function contourArea(points: Vec2[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i]!.x * points[j]!.y
    area -= points[j]!.x * points[i]!.y
  }
  return Math.abs(area / 2)
}

// ── Main ──

console.log("Initializing Rapier...")
await RAPIER.init()

// Throwaway world just to compute convex hulls via Rapier's own algorithm
const hullWorld = new RAPIER.World({ x: 0, y: 0 })
const hullBody = hullWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed())

console.log("Loading font...")
const fontBuffer = await Bun.file(FONT_PATH).arrayBuffer()
const font = opentype.parse(fontBuffer)
console.log(`  Font: ${font.names.fontFamily.en}, ${font.numGlyphs} glyphs`)

const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
const glyphs: Record<string, GlyphData> = {}
let totalParts = 0

for (const char of chars) {
  const path = font.getPath(char, 0, 0, FONT_SIZE)
  const bb = path.getBoundingBox()
  const rawContours = pathToContours(path)

  const normalizedContours = rawContours.map((contour) =>
    contour.map((p) => ({ x: p.x - bb.x1, y: p.y - bb.y1 })),
  )

  const allParts: number[][] = []

  for (const contour of normalizedContours) {
    if (contourArea(contour) < MIN_CONTOUR_AREA) continue

    // Feed all contour points to Rapier's convexHull — it computes
    // the minimal hull and strips collinear/redundant vertices.
    const inputPts = new Float32Array(contour.length * 2)
    for (let i = 0; i < contour.length; i++) {
      inputPts[i * 2] = contour[i]!.x
      inputPts[i * 2 + 1] = contour[i]!.y
    }
    const desc = RAPIER.ColliderDesc.convexHull(inputPts)
    if (!desc) continue

    const collider = hullWorld.createCollider(desc, hullBody)
    const verts = collider.vertices()
    const flat: number[] = []
    for (let i = 0; i < verts.length; i++) {
      flat.push(Math.round(verts[i]! * 10) / 10)
    }
    hullWorld.removeCollider(collider, false)
    if (flat.length >= 6) allParts.push(flat)
  }

  const width = Math.round((bb.x2 - bb.x1) * 100) / 100
  const height = Math.round((bb.y2 - bb.y1) * 100) / 100

  glyphs[char] = {
    char,
    convexParts: allParts,
    width,
    height,
    offsetX: Math.round(bb.x1 * 100) / 100,
    offsetY: Math.round(bb.y1 * 100) / 100,
  }

  totalParts += allParts.length
  console.log(
    `  ${char}: ${allParts.length} parts, ${width.toFixed(0)}x${height.toFixed(0)}`,
  )
}

console.log(`\nTotal: ${totalParts} parts across ${chars.length} chars`)
console.log(`Average: ${(totalParts / chars.length).toFixed(1)} parts/char`)

const json = JSON.stringify(glyphs)
await Bun.write(OUTPUT_PATH, json)
const size = new Blob([json]).size
console.log(`Output: ${OUTPUT_PATH} (${(size / 1024).toFixed(1)} KB)`)

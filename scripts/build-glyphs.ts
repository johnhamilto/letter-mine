/**
 * Extract glyph outlines from Playfair Display, triangulate with earcut,
 * and output triangle data for Rapier 2D compound colliders.
 *
 * Pipeline:
 *   Font file → glyph paths → bezier sampling → polygon contours
 *   → earcut triangulation → triangles as convex parts → JSON
 *
 * No hole handling needed — each contour is triangulated independently
 * as a solid shape. In 2D physics, "o" is two solid rings, not a hollow shape.
 */

import opentype from "opentype.js"
import earcut from "earcut"

const FONT_PATH = `${import.meta.dirname}/../public/fonts/PlayfairDisplay.ttf`
const OUTPUT_PATH = `${import.meta.dirname}/../dist/glyphs.json`

// Segments per bezier curve
const BEZIER_RESOLUTION = 8

const FONT_SIZE = 100

// Minimum area to keep a contour (filters artifacts, keeps "i" dot)
const MIN_CONTOUR_AREA = 1

interface Vec2 { x: number; y: number }

interface GlyphData {
  char: string
  convexParts: number[][] // triangles as flat [x1,y1,x2,y2,x3,y3] arrays
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

function sampleCubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, steps: number): Vec2[] {
  const points: Vec2[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    points.push({
      x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
      y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
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
        current.push(...sampleQuadratic(
          cursor, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x, y: cmd.y }, BEZIER_RESOLUTION
        ))
        cursor = { x: cmd.x, y: cmd.y }
        break
      case "C":
        current.push(...sampleCubic(
          cursor,
          { x: cmd.x1, y: cmd.y1 },
          { x: cmd.x2, y: cmd.y2 },
          { x: cmd.x, y: cmd.y },
          BEZIER_RESOLUTION
        ))
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

// ── Utilities ──

function contourArea(points: Vec2[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i]!.x * points[j]!.y
    area -= points[j]!.x * points[i]!.y
  }
  return Math.abs(area / 2)
}

function triangulateContour(contour: Vec2[]): number[][] {
  // Flatten to earcut format: [x1,y1, x2,y2, ...]
  const flat: number[] = []
  for (const p of contour) {
    flat.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10)
  }

  // earcut returns triangle indices into the flat vertex array
  const indices = earcut(flat)

  // Convert indices to individual triangle vertex arrays
  const triangles: number[][] = []
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i]!
    const i1 = indices[i + 1]!
    const i2 = indices[i + 2]!
    triangles.push([
      flat[i0 * 2]!, flat[i0 * 2 + 1]!,
      flat[i1 * 2]!, flat[i1 * 2 + 1]!,
      flat[i2 * 2]!, flat[i2 * 2 + 1]!,
    ])
  }

  return triangles
}

// ── Main ──

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

  // Normalize: shift so origin is at bounding box top-left
  const normalizedContours = rawContours.map(contour =>
    contour.map(p => ({ x: p.x - bb.x1, y: p.y - bb.y1 }))
  )

  const allTriangles: number[][] = []

  for (const contour of normalizedContours) {
    const area = contourArea(contour)
    if (area < MIN_CONTOUR_AREA) continue

    const tris = triangulateContour(contour)
    allTriangles.push(...tris)
  }

  const width = Math.round((bb.x2 - bb.x1) * 100) / 100
  const height = Math.round((bb.y2 - bb.y1) * 100) / 100

  glyphs[char] = {
    char,
    convexParts: allTriangles,
    width,
    height,
    offsetX: Math.round(bb.x1 * 100) / 100,
    offsetY: Math.round(bb.y1 * 100) / 100,
  }

  totalParts += allTriangles.length
  console.log(`  ${char}: ${allTriangles.length} triangles, ${width.toFixed(0)}x${height.toFixed(0)}`)
}

console.log(`\n  Total: ${totalParts} triangles across ${chars.length} chars`)

const json = JSON.stringify(glyphs)
await Bun.write(OUTPUT_PATH, json)
const size = new Blob([json]).size
console.log(`  Output: ${OUTPUT_PATH} (${(size / 1024).toFixed(1)} KB)`)

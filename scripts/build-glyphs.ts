/**
 * Extract glyph outlines from Playfair Display and decompose into
 * convex parts using Approximate Convex Decomposition (ACD).
 *
 * Pipeline:
 *   Font file → glyph paths → bezier sampling → polygon contours
 *   → ACD (concavity-based recursive splitting) → convex parts → JSON
 *
 * Each contour is decomposed independently. The ACD algorithm recursively
 * splits at the most concave vertex until all pieces have concavity
 * below the threshold, producing near-minimum convex part counts.
 */

import opentype from "opentype.js"
import { type GlyphData } from "../src/types"

const FONT_PATH = `${import.meta.dir}/../public/fonts/PlayfairDisplay.ttf`
const OUTPUT_PATH = `${import.meta.dir}/../dist/glyphs.json`

// Segments per bezier curve
const BEZIER_RESOLUTION = 3

const FONT_SIZE = 100

// Minimum area to keep a contour (filters artifacts, keeps "i" dot)
const MIN_CONTOUR_AREA = 1

// Minimum area to keep a decomposed part
const MIN_PART_AREA = 0.5

// ACD concavity threshold: max distance (glyph units) from any reflex vertex
// to the convex hull before we split. Calibrated against simplified polygons:
// T=7.2, U=7.9, v=5.7 — threshold of 6.0 splits T/U/L while keeping v as 1 hull.
const CONCAVITY_THRESHOLD = 7.0

const MAX_ACD_DEPTH = 8

interface Vec2 {
  x: number
  y: number
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

// ── Polygon utilities ──

function contourArea(points: Vec2[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i]!.x * points[j]!.y
    area -= points[j]!.x * points[i]!.y
  }
  return Math.abs(area / 2)
}

function polySignedArea(polygon: Vec2[]): number {
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    area += polygon[i]!.x * polygon[j]!.y
    area -= polygon[j]!.x * polygon[i]!.y
  }
  return area / 2
}

function ensureCCW(polygon: Vec2[]): Vec2[] {
  return polySignedArea(polygon) < 0 ? [...polygon].reverse() : polygon
}

// ── Polygon simplification (Douglas-Peucker) ──
// Reduces vertex count while preserving shape structure.
// Critical for ACD: eliminates hundreds of bezier-sampling reflex vertices
// that would otherwise cause cascading splits on smooth curves.

const SIMPLIFY_TOLERANCE = 4.0

function perpendicularDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  const px = a.x + t * dx
  const py = a.y + t * dy
  return Math.sqrt((p.x - px) ** 2 + (p.y - py) ** 2)
}

function douglasPeucker(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length <= 2) return points

  let maxDist = 0
  let maxIdx = 0
  const last = points.length - 1
  for (let i = 1; i < last; i++) {
    const d = perpendicularDist(points[i]!, points[0]!, points[last]!)
    if (d > maxDist) {
      maxDist = d
      maxIdx = i
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon)
    const right = douglasPeucker(points.slice(maxIdx), epsilon)
    return [...left.slice(0, -1), ...right]
  }

  return [points[0]!, points[last]!]
}

function simplifyContour(contour: Vec2[], epsilon: number): Vec2[] {
  if (contour.length <= 4) return contour

  // For closed contours: find the vertex farthest from vertex 0,
  // split into two halves, simplify each, then recombine.
  // This avoids artifacts at the seam.
  let maxDist = 0
  let splitIdx = 0
  const p0 = contour[0]!
  for (let i = 1; i < contour.length; i++) {
    const dx = contour[i]!.x - p0.x
    const dy = contour[i]!.y - p0.y
    const d = dx * dx + dy * dy
    if (d > maxDist) {
      maxDist = d
      splitIdx = i
    }
  }

  const half1 = contour.slice(0, splitIdx + 1)
  const half2 = [...contour.slice(splitIdx), contour[0]!]

  const s1 = douglasPeucker(half1, epsilon)
  const s2 = douglasPeucker(half2, epsilon)

  // Combine: s1 ends at splitIdx, s2 starts at splitIdx and ends at 0
  // Remove duplicate junction points
  return [...s1.slice(0, -1), ...s2.slice(0, -1)]
}

// ── Convex hull (Andrew's monotone chain) ──

function computeConvexHull(points: Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length <= 2) return sorted

  const lower: Vec2[] = []
  for (const p of sorted) {
    while (lower.length >= 2) {
      const a = lower[lower.length - 2]!
      const b = lower[lower.length - 1]!
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= 0)
        lower.pop()
      else break
    }
    lower.push(p)
  }

  const upper: Vec2[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!
    while (upper.length >= 2) {
      const a = upper[upper.length - 2]!
      const b = upper[upper.length - 1]!
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= 0)
        upper.pop()
      else break
    }
    upper.push(p)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

// ── ACD: Approximate Convex Decomposition ──

function pointToSegmentDistSq(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq),
  )
  const px = a.x + t * dx
  const py = a.y + t * dy
  return (p.x - px) ** 2 + (p.y - py) ** 2
}

function distToHull(point: Vec2, hull: Vec2[]): number {
  let minSq = Infinity
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length
    const sq = pointToSegmentDistSq(point, hull[i]!, hull[j]!)
    if (sq < minSq) minSq = sq
  }
  return Math.sqrt(minSq)
}

interface RayHit {
  t: number
  point: Vec2
  edgeIdx: number
}

function raycast(
  origin: Vec2,
  dir: Vec2,
  polygon: Vec2[],
  skipEdges: Set<number>,
): RayHit | null {
  const n = polygon.length
  let best: RayHit | null = null

  for (let i = 0; i < n; i++) {
    if (skipEdges.has(i)) continue
    const a = polygon[i]!
    const b = polygon[(i + 1) % n]!
    const ex = b.x - a.x
    const ey = b.y - a.y
    const denom = dir.x * ey - dir.y * ex
    if (Math.abs(denom) < 1e-10) continue

    const t =
      ((a.x - origin.x) * ey - (a.y - origin.y) * ex) / denom
    const s =
      ((a.x - origin.x) * dir.y - (a.y - origin.y) * dir.x) / denom

    // t > 0: hit is in front of ray origin
    // s in (0,1): hit is in interior of edge (not at endpoints)
    if (t > 1e-4 && s > 1e-6 && s < 1 - 1e-6) {
      if (!best || t < best.t) {
        best = {
          t,
          point: {
            x: origin.x + t * dir.x,
            y: origin.y + t * dir.y,
          },
          edgeIdx: i,
        }
      }
    }
  }

  return best
}

function splitPolygon(
  polygon: Vec2[],
  splitIdx: number,
  hitEdge: number,
  hitPoint: Vec2,
): [Vec2[], Vec2[]] {
  const n = polygon.length

  // Part 1: walk from splitIdx → hitEdge, then append hitPoint
  const part1: Vec2[] = []
  let i = splitIdx
  for (let c = 0; c <= n; c++) {
    part1.push(polygon[i]!)
    if (i === hitEdge) break
    i = (i + 1) % n
  }
  part1.push(hitPoint)

  // Part 2: hitPoint, then walk from hitEdge+1 → splitIdx
  const part2: Vec2[] = [hitPoint]
  i = (hitEdge + 1) % n
  for (let c = 0; c <= n; c++) {
    part2.push(polygon[i]!)
    if (i === splitIdx) break
    i = (i + 1) % n
  }

  return [part1, part2]
}

function trySplit(
  polygon: Vec2[],
  concaveIdx: number,
): [Vec2[], Vec2[]] | null {
  const n = polygon.length
  const v = polygon[concaveIdx]!
  const prev = polygon[(concaveIdx - 1 + n) % n]!
  const next = polygon[(concaveIdx + 1) % n]!

  // Skip the two edges incident to the concave vertex
  const skipEdges = new Set<number>([
    (concaveIdx - 1 + n) % n,
    concaveIdx,
  ])

  // Bisector of the two edge vectors at v — points into the concavity
  const e1x = prev.x - v.x
  const e1y = prev.y - v.y
  const e2x = next.x - v.x
  const e2y = next.y - v.y
  const len1 = Math.sqrt(e1x * e1x + e1y * e1y)
  const len2 = Math.sqrt(e2x * e2x + e2y * e2y)
  if (len1 < 1e-10 || len2 < 1e-10) return null

  const bx = e1x / len1 + e2x / len2
  const by = e1y / len1 + e2y / len2
  const blen = Math.sqrt(bx * bx + by * by)
  if (blen < 1e-10) return null

  const baseDir = { x: bx / blen, y: by / blen }
  const totalArea = Math.abs(polySignedArea(polygon))

  // Try the bisector, then rotated variations, then opposite direction
  const angles = [0, 0.3, -0.3, 0.6, -0.6, 1.0, -1.0, 1.4, -1.4, Math.PI]
  for (const angle of angles) {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const dir = {
      x: baseDir.x * cos - baseDir.y * sin,
      y: baseDir.x * sin + baseDir.y * cos,
    }
    const hit = raycast(v, dir, polygon, skipEdges)
    if (hit) {
      const [p1, p2] = splitPolygon(polygon, concaveIdx, hit.edgeIdx, hit.point)
      // Quality check: reject sliver cuts where one piece is < 10% of total
      const a1 = Math.abs(polySignedArea(p1))
      const a2 = Math.abs(polySignedArea(p2))
      if (Math.min(a1, a2) < totalArea * 0.10) continue
      return [p1, p2]
    }
  }

  return null
}

function findAllReflex(polygon: Vec2[], threshold: number): number[] {
  const hull = computeConvexHull(polygon)
  if (hull.length < 3) return []

  const n = polygon.length
  const result: number[] = []

  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n]!
    const curr = polygon[i]!
    const next = polygon[(i + 1) % n]!
    const cross =
      (curr.x - prev.x) * (next.y - curr.y) -
      (curr.y - prev.y) * (next.x - curr.x)
    if (cross < -1e-6) {
      const c = distToHull(curr, hull)
      if (c > threshold) result.push(i)
    }
  }
  return result
}

function decomposeACD(
  polygon: Vec2[],
  threshold: number,
  depth: number = 0,
): Vec2[][] {
  if (polygon.length < 3) return []
  if (depth >= MAX_ACD_DEPTH) return [polygon]

  const area = Math.abs(polySignedArea(polygon))
  if (area < MIN_PART_AREA) return []

  // Find all reflex vertices above threshold
  const candidates = findAllReflex(polygon, threshold)
  if (candidates.length === 0) return [polygon]

  // Try every candidate and pick the most balanced split
  let bestSplit: [Vec2[], Vec2[]] | null = null
  let bestBalance = 0

  for (const idx of candidates) {
    const result = trySplit(polygon, idx)
    if (!result) continue
    const [p1, p2] = result
    const a1 = Math.abs(polySignedArea(p1))
    const a2 = Math.abs(polySignedArea(p2))
    const balance = Math.min(a1, a2) / (a1 + a2)
    if (balance > bestBalance) {
      bestBalance = balance
      bestSplit = [p1, p2]
    }
  }

  if (!bestSplit) return [polygon]

  const [p1, p2] = bestSplit
  return [
    ...decomposeACD(p1, threshold, depth + 1),
    ...decomposeACD(p2, threshold, depth + 1),
  ]
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

  const normalizedContours = rawContours.map((contour) =>
    contour.map((p) => ({ x: p.x - bb.x1, y: p.y - bb.y1 })),
  )

  const allParts: number[][] = []

  for (const contour of normalizedContours) {
    if (contourArea(contour) < MIN_CONTOUR_AREA) continue

    const ccw = ensureCCW(contour)
    const simplified = simplifyContour(ccw, SIMPLIFY_TOLERANCE)
    const parts = decomposeACD(simplified, CONCAVITY_THRESHOLD)

    for (const part of parts) {
      const flat: number[] = []
      for (const p of part) {
        flat.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10)
      }
      if (flat.length >= 6) allParts.push(flat)
    }
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

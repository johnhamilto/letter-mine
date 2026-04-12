import type RAPIER_NS from "@dimforge/rapier2d-compat"

interface GlyphData {
  char: string
  convexParts: number[][]
  width: number
  height: number
  offsetX: number
  offsetY: number
}

export interface LetterBody {
  body: RAPIER_NS.RigidBody
  glyph: GlyphData
  char: string
  isUpper: boolean
  renderScale: number
}

// Scale factor for glyph vertices → physics units
// Glyph data is at FONT_SIZE=100, we need to convert to physics meters
const GLYPH_TO_PHYSICS = 1 / 100

export function createLetterBody(
  RAPIER: typeof RAPIER_NS,
  world: RAPIER_NS.World,
  glyph: GlyphData,
  x: number,
  y: number,
): LetterBody | null {
  const isUpper = glyph.char === glyph.char.toUpperCase()
  const renderScale = isUpper ? 1.0 : 0.6
  const physScale = GLYPH_TO_PHYSICS * renderScale

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y)
    .setAngularDamping(0.5)
    .setLinearDamping(0.1)
    .setCcdEnabled(true)

  const body = world.createRigidBody(bodyDesc)

  // Center of the glyph in glyph coordinates
  const cx = glyph.width / 2
  const cy = glyph.height / 2

  let collidersCreated = 0

  // Each convex part becomes its own collider, all on the same body
  for (const part of glyph.convexParts) {
    if (part.length < 6) continue

    // Center and scale the vertices
    const points = new Float32Array(part.length)
    for (let i = 0; i < part.length; i += 2) {
      points[i] = (part[i]! - cx) * physScale
      points[i + 1] = (part[i + 1]! - cy) * physScale
    }

    const colliderDesc = RAPIER.ColliderDesc.convexHull(points)
    if (colliderDesc) {
      colliderDesc.setDensity(isUpper ? 2.0 : 1.0)
      colliderDesc.setRestitution(0.2)
      colliderDesc.setFriction(0.6)
      try {
        world.createCollider(colliderDesc, body)
        collidersCreated++
      } catch {
        // Skip degenerate triangles that Rapier rejects
      }
    }
  }

  // Fallback: if decomposition produced nothing, use a rectangle
  if (collidersCreated === 0) {
    const halfW = (glyph.width * physScale) / 2
    const halfH = (glyph.height * physScale) / 2
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfW, halfH)
      .setDensity(isUpper ? 2.0 : 1.0)
      .setRestitution(0.2)
      .setFriction(0.6)
    world.createCollider(colliderDesc, body)
  }

  return {
    body,
    glyph,
    char: glyph.char,
    isUpper,
    renderScale,
  }
}

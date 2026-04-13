import type RAPIER_NS from "@dimforge/rapier2d-compat"
import { GLYPH_TO_PHYSICS, LOWERCASE_SCALE, UPPERCASE_SCALE } from "./constants"
import type { GlyphData, LetterBody } from "./types"

export type { LetterBody }

export function createLetterBody(
  RAPIER: typeof RAPIER_NS,
  world: RAPIER_NS.World,
  glyph: GlyphData,
  x: number,
  y: number,
): LetterBody | null {
  const isUpper = glyph.char === glyph.char.toUpperCase()
  const renderScale = isUpper ? UPPERCASE_SCALE : LOWERCASE_SCALE
  const physScale = GLYPH_TO_PHYSICS * renderScale

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y)
    .setAngularDamping(2.0)
    .setLinearDamping(0.3)
    .setCcdEnabled(true)

  const body = world.createRigidBody(bodyDesc)

  const cx = glyph.width / 2
  const cy = glyph.height / 2

  let collidersCreated = 0

  for (const part of glyph.convexParts) {
    if (part.length < 6) continue

    const points = new Float32Array(part.length)
    for (let i = 0; i < part.length; i += 2) {
      points[i] = (part[i]! - cx) * physScale
      points[i + 1] = (part[i + 1]! - cy) * physScale
    }

    const colliderDesc = RAPIER.ColliderDesc.convexHull(points)
    if (colliderDesc) {
      colliderDesc.setDensity(isUpper ? 2.0 : 1.0)
      colliderDesc.setRestitution(0.0)
      colliderDesc.setFriction(0.6)
      try {
        world.createCollider(colliderDesc, body)
        collidersCreated++
      } catch {
        // Skip degenerate shapes Rapier rejects
      }
    }
  }

  if (collidersCreated === 0) {
    const halfW = (glyph.width * physScale) / 2
    const halfH = (glyph.height * physScale) / 2
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfW, halfH)
      .setDensity(isUpper ? 2.0 : 1.0)
      .setRestitution(0.0)
      .setFriction(0.6)
    world.createCollider(colliderDesc, body)
  }

  return { body, glyph, char: glyph.char, isUpper, renderScale }
}

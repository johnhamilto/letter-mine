/** Physics Web Worker — owns the Rapier 2D world, steps physics off main thread. */

import RAPIER from '@dimforge/rapier2d-compat'
import type { GlyphData, PhysicsWorkerInMsg, PhysicsWorkerOutMsg, BodyState } from './types'

const GLYPH_TO_PHYSICS = 1 / 100
const LOWERCASE_SCALE = 0.6
const UPPERCASE_SCALE = 1.0
const FIXED_DT = 1 / 60

let world: RAPIER.World | null = null
let glyphs: Record<string, GlyphData> = {}

const bodyMap = new Map<number, RAPIER.RigidBody>()
let wallBodies: RAPIER.RigidBody[] = []
let floorBody: RAPIER.RigidBody | null = null

function createLetterBody(id: number, char: string, x: number, y: number): boolean {
  if (!world) return false
  const glyph = glyphs[char]
  if (!glyph) return false

  const isUpper = char === char.toUpperCase()
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

  bodyMap.set(id, body)
  return true
}

function buildWalls(w: number, h: number, isDraining: boolean) {
  if (!world) return

  for (const body of wallBodies) {
    world.removeRigidBody(body)
  }
  wallBodies = []
  floorBody = null

  if (!isDraining) {
    const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, h))
    world.createCollider(RAPIER.ColliderDesc.halfspace(new RAPIER.Vector2(0, -1)), floor)
    wallBodies.push(floor)
    floorBody = floor
  }

  const sides: Array<{ x: number; y: number; nx: number; ny: number }> = [
    { x: 0, y: 0, nx: 0, ny: 1 },
    { x: 0, y: 0, nx: 1, ny: 0 },
    { x: w, y: 0, nx: -1, ny: 0 },
  ]

  for (const wall of sides) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(wall.x, wall.y))
    world.createCollider(RAPIER.ColliderDesc.halfspace(new RAPIER.Vector2(wall.nx, wall.ny)), body)
    wallBodies.push(body)
  }
}

function removeFloor() {
  if (!world || !floorBody) return
  world.removeRigidBody(floorBody)
  const idx = wallBodies.indexOf(floorBody)
  if (idx >= 0) wallBodies.splice(idx, 1)
  floorBody = null
}

function restoreFloor(h: number) {
  if (!world || floorBody) return
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, h))
  world.createCollider(RAPIER.ColliderDesc.halfspace(new RAPIER.Vector2(0, -1)), floor)
  wallBodies.push(floor)
  floorBody = floor
}

function step(): BodyState[] {
  if (!world) return []
  world.step()

  const result: BodyState[] = []
  for (const [id, body] of bodyMap) {
    const pos = body.translation()
    result.push({
      id,
      x: pos.x,
      y: pos.y,
      rotation: body.rotation(),
    })
  }
  return result
}

function post(msg: PhysicsWorkerOutMsg) {
  self.postMessage(msg)
}

self.onmessage = (e: MessageEvent<PhysicsWorkerInMsg>) => {
  const msg = e.data

  switch (msg.type) {
    case 'init': {
      RAPIER.init().then(() => {
        world = new RAPIER.World(new RAPIER.Vector2(0, msg.gravity))
        const ip = world.integrationParameters
        ip.numSolverIterations = msg.solverIterations
        ip.numInternalPgsIterations = msg.pgsIterations
        ip.contact_natural_frequency = msg.contactFrequency
        ip.normalizedPredictionDistance = msg.predictionDistance
        ip.normalizedAllowedLinearError = msg.allowedLinearError
        ip.maxCcdSubsteps = msg.maxCcdSubsteps
        ip.dt = FIXED_DT

        glyphs = msg.glyphs

        const SCALE = 100
        buildWalls(msg.wallWidth / SCALE, msg.wallHeight / SCALE, false)

        post({ type: 'ready' })
      })
      break
    }

    case 'spawn': {
      createLetterBody(msg.id, msg.char, msg.x, msg.y)
      break
    }

    case 'remove': {
      const body = bodyMap.get(msg.id)
      if (body && world) {
        world.removeRigidBody(body)
        bodyMap.delete(msg.id)
      }
      break
    }

    case 'setLinvel': {
      const body = bodyMap.get(msg.id)
      if (body) {
        body.setLinvel(new RAPIER.Vector2(msg.vx, msg.vy), true)
      }
      break
    }

    case 'setAngvel': {
      const body = bodyMap.get(msg.id)
      if (body) {
        body.setAngvel(msg.angvel, true)
      }
      break
    }

    case 'setGravityScale': {
      const body = bodyMap.get(msg.id)
      if (body) {
        body.setGravityScale(msg.scale, true)
      }
      break
    }

    case 'wakeUp': {
      const body = bodyMap.get(msg.id)
      if (body) {
        body.wakeUp()
      }
      break
    }

    case 'applyImpulse': {
      const body = bodyMap.get(msg.id)
      if (body) {
        body.applyImpulse(new RAPIER.Vector2(msg.ix, msg.iy), true)
      }
      break
    }

    case 'applyTorqueImpulse': {
      const body = bodyMap.get(msg.id)
      if (body) {
        body.applyTorqueImpulse(msg.torque, true)
      }
      break
    }

    case 'rebuildWalls': {
      const SCALE = 100
      buildWalls(msg.width / SCALE, msg.height / SCALE, msg.isDraining)
      break
    }

    case 'removeFloor': {
      removeFloor()
      break
    }

    case 'restoreFloor': {
      const SCALE = 100
      restoreFloor(msg.height / SCALE)
      break
    }

    case 'step': {
      const bodies = step()
      post({ type: 'stepResult', bodies })
      break
    }
  }
}

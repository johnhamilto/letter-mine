/**
 * Physics proxy — sends spawn/remove/force messages to the physics worker.
 * No Rapier imports on the main thread.
 */

import { SCALE, LOWERCASE_SCALE, UPPERCASE_SCALE, PHYSICS } from './constants'
import type {
  GlyphData,
  LetterBody,
  PhysicsWorkerInMsg,
  PhysicsWorkerOutMsg,
  BodyState,
} from './types'

export type { LetterBody }

export class PhysicsProxy {
  private worker: Worker
  private nextId = 1
  private onStepResult: ((bodies: BodyState[]) => void) | null = null
  private onReady: (() => void) | null = null

  constructor() {
    this.worker = new Worker(new URL('./physics-worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<PhysicsWorkerOutMsg>) => {
      const msg = e.data
      switch (msg.type) {
        case 'stepResult':
          this.onStepResult?.(msg.bodies)
          break
        case 'ready':
          this.onReady?.()
          break
      }
    }
  }

  private send(msg: PhysicsWorkerInMsg) {
    this.worker.postMessage(msg)
  }

  init(glyphs: Record<string, GlyphData>, wallWidth: number, wallHeight: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.onReady = () => {
        this.onReady = null
        resolve()
      }
      this.send({
        type: 'init',
        gravity: PHYSICS.gravity,
        solverIterations: PHYSICS.solverIterations,
        pgsIterations: PHYSICS.pgsIterations,
        contactFrequency: PHYSICS.contactFrequency,
        predictionDistance: PHYSICS.predictionDistance,
        allowedLinearError: PHYSICS.allowedLinearError,
        maxCcdSubsteps: PHYSICS.maxCcdSubsteps,
        glyphs,
        wallWidth,
        wallHeight,
      })
    })
  }

  spawn(glyph: GlyphData, x: number, y: number): LetterBody {
    const id = this.nextId++
    const isUpper = glyph.char === glyph.char.toUpperCase()
    const renderScale = isUpper ? UPPERCASE_SCALE : LOWERCASE_SCALE

    this.send({
      type: 'spawn',
      id,
      char: glyph.char,
      x: x / SCALE,
      y: y / SCALE,
    })

    return {
      id,
      glyph,
      char: glyph.char,
      isUpper,
      renderScale,
      x: x / SCALE,
      y: y / SCALE,
      rotation: 0,
    }
  }

  remove(id: number) {
    this.send({ type: 'remove', id })
  }

  setLinvel(id: number, vx: number, vy: number) {
    this.send({ type: 'setLinvel', id, vx, vy })
  }

  setAngvel(id: number, angvel: number) {
    this.send({ type: 'setAngvel', id, angvel })
  }

  setGravityScale(id: number, scale: number) {
    this.send({ type: 'setGravityScale', id, scale })
  }

  wakeUp(id: number) {
    this.send({ type: 'wakeUp', id })
  }

  applyImpulse(id: number, ix: number, iy: number) {
    this.send({ type: 'applyImpulse', id, ix, iy })
  }

  applyTorqueImpulse(id: number, torque: number) {
    this.send({ type: 'applyTorqueImpulse', id, torque })
  }

  rebuildWalls(width: number, height: number, isDraining: boolean) {
    this.send({ type: 'rebuildWalls', width, height, isDraining })
  }

  removeFloor() {
    this.send({ type: 'removeFloor' })
  }

  restoreFloor(height: number) {
    this.send({ type: 'restoreFloor', height })
  }

  step(callback: (bodies: BodyState[]) => void) {
    this.onStepResult = callback
    this.send({ type: 'step' })
  }
}

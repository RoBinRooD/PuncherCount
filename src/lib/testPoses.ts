import type { Landmark } from './detector'

/**
 * Synthetic side-view skeleton. The boxer faces +x (bag on the right of the frame).
 * Torso length is 0.3 (normalized units); arm segments 0.18 each.
 */
export interface Pose {
  /** wrist offsets from the shoulder, in torso lengths */
  left: { x: number; y: number; elbowBent?: boolean }
  right: { x: number; y: number; elbowBent?: boolean }
}

const SH = { x: 0.5, y: 0.35 }
const TORSO = 0.3

function arm(w: { x: number; y: number; elbowBent?: boolean }) {
  const wrist = { x: SH.x + w.x * TORSO, y: SH.y + w.y * TORSO }
  // Straight arm: elbow halfway. Bent arm: elbow pushed down so the angle is ~90°.
  const m = { x: (SH.x + wrist.x) / 2, y: (SH.y + wrist.y) / 2 }
  const dx = wrist.x - SH.x
  const dy = wrist.y - SH.y
  const elbow = w.elbowBent ? { x: m.x + dy / 2, y: m.y + Math.abs(dx) / 2 } : m
  return { wrist, elbow }
}

export function frame(pose: Pose): Landmark[] {
  const lms: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }))
  const set = (i: number, p: { x: number; y: number }) => (lms[i] = { ...p, visibility: 1 })
  set(0, { x: SH.x + 0.05, y: SH.y - 0.12 }) // nose ahead of shoulders -> facing +x
  set(11, SH)
  set(12, SH)
  set(23, { x: SH.x, y: SH.y + TORSO })
  set(24, { x: SH.x, y: SH.y + TORSO })
  const l = arm(pose.left)
  const r = arm(pose.right)
  set(13, l.elbow)
  set(15, l.wrist)
  set(14, r.elbow)
  set(16, r.wrist)
  return lms
}

export const GUARD = { x: 0.25, y: 0.1, elbowBent: true }

export type Arm = { x: number; y: number; elbowBent?: boolean }

/** Move one arm from guard to `target` and back over `ms`, 30 fps. */
export function punchFrames(hand: 'left' | 'right', target: Arm, ms = 300): Pose[] {
  const frames: Pose[] = []
  const n = Math.round((ms / 1000) * 30)
  for (let i = 0; i <= n; i++) {
    const k = i <= n / 2 ? i / (n / 2) : (n - i) / (n / 2)
    const w = {
      x: GUARD.x + (target.x - GUARD.x) * k,
      y: GUARD.y + (target.y - GUARD.y) * k,
      elbowBent: k < 0.5 ? true : target.elbowBent,
    }
    frames.push(hand === 'left' ? { left: w, right: GUARD } : { left: GUARD, right: w })
  }
  return frames
}

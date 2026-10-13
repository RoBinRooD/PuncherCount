import type { Hand, PunchEvent, Stance } from './types'

/**
 * Punch detector for a side-on camera (phone placed beside the bag, boxer seen in profile).
 *
 * Works on MediaPipe Pose landmarks. Per arm, the wrist position is expressed relative to
 * the shoulder and scaled by torso length, so walking around or moving closer to the
 * camera doesn't change the thresholds. A punch is a fast wrist movement away from its
 * start point; when it stops (or starts coming back) the movement is classified:
 *
 *  - uppercut: displacement is mostly upward
 *  - hook:     moves forward with the elbow still bent at the furthest point
 *  - straight: moves forward and the arm extends (jab = lead hand, cross = rear hand)
 *
 * Movements that go backwards (retracting the hand to guard) are ignored.
 */

export interface Landmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

export interface DetectorConfig {
  stance: Stance
  /** Swap MediaPipe's left/right if the camera angle makes it mislabel the arms. */
  swapHands: boolean
  /** Wrist speed (torso lengths per second) that starts a punch. */
  minSpeed: number
  /** Minimum wrist travel (torso lengths) for a movement to count as a punch. */
  minDistance: number
  /** Ignore a new punch from the same hand within this many ms. */
  cooldownMs: number
  /** Elbow angle (degrees) at the furthest point below which a forward punch is a hook. */
  hookElbowAngle: number
  /** Share of the displacement that must be upward to call it an uppercut. */
  uppercutRatio: number
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  stance: 'orthodox',
  swapHands: false,
  minSpeed: 2.2,
  minDistance: 0.32,
  cooldownMs: 160,
  hookElbowAngle: 125,
  uppercutRatio: 0.6,
}

// MediaPipe Pose landmark indices
const NOSE = 0
const L_SHOULDER = 11
const R_SHOULDER = 12
const L_ELBOW = 13
const R_ELBOW = 14
const L_WRIST = 15
const R_WRIST = 16
const L_HIP = 23
const R_HIP = 24

const MAX_PUNCH_MS = 700
const MIN_PUNCH_MS = 40
const MIN_VISIBILITY = 0.2
const SMOOTHING = 0.6

interface Vec {
  x: number
  y: number
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const len = (a: Vec) => Math.hypot(a.x, a.y)
const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

function angleDeg(a: Vec, b: Vec, c: Vec): number {
  const ba = sub(a, b)
  const bc = sub(c, b)
  const d = len(ba) * len(bc)
  if (d === 0) return 180
  const cos = Math.min(1, Math.max(-1, (ba.x * bc.x + ba.y * bc.y) / d))
  return (Math.acos(cos) * 180) / Math.PI
}

interface ArmState {
  prevRel: Vec | null
  prevT: number
  moving: boolean
  startRel: Vec
  startT: number
  peakRel: Vec
  peakDist: number
  peakElbow: number
  peakWristBelowShoulder: number
  lastPunchT: number
  speed: number
  elbow: number
}

export interface ArmDebug {
  speed: number
  elbow: number
  moving: boolean
  visible: boolean
}

export interface DetectorDebug {
  facing: 1 | -1
  scale: number
  left: ArmDebug
  right: ArmDebug
}

function newArm(): ArmState {
  return {
    prevRel: null,
    prevT: 0,
    moving: false,
    startRel: { x: 0, y: 0 },
    startT: 0,
    peakRel: { x: 0, y: 0 },
    peakDist: 0,
    peakElbow: 180,
    peakWristBelowShoulder: 0,
    lastPunchT: -Infinity,
    speed: 0,
    elbow: 180,
  }
}

export class PunchDetector {
  config: DetectorConfig
  private arms: Record<Hand, ArmState> = { left: newArm(), right: newArm() }
  private smooth: (Vec | null)[] = []
  private scale = 0
  private facingAvg = 0
  private visible: Record<Hand, boolean> = { left: false, right: false }

  constructor(config: Partial<DetectorConfig> = {}) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config }
  }

  reset() {
    this.arms = { left: newArm(), right: newArm() }
    this.smooth = []
    this.scale = 0
    this.facingAvg = 0
  }

  get facing(): 1 | -1 {
    return this.facingAvg >= 0 ? 1 : -1
  }

  debug(): DetectorDebug {
    const arm = (h: Hand): ArmDebug => ({
      speed: this.arms[h].speed,
      elbow: this.arms[h].elbow,
      moving: this.arms[h].moving,
      visible: this.visible[h],
    })
    return { facing: this.facing, scale: this.scale, left: arm('left'), right: arm('right') }
  }

  /**
   * Feed one frame of landmarks (normalized 0..1 image coords).
   * `aspect` = video width / height so x and y share one unit.
   * Returns punches whose `t` is the frame timestamp in ms (caller rebases to round time).
   */
  update(landmarks: Landmark[] | undefined, tMs: number, aspect = 1): PunchEvent[] {
    if (!landmarks || landmarks.length < 25) {
      this.visible = { left: false, right: false }
      return []
    }
    const p = (i: number): Vec | null => {
      const lm = landmarks[i]
      if (!lm || (lm.visibility ?? 1) < MIN_VISIBILITY) return null
      const raw = { x: lm.x * aspect, y: lm.y }
      const prev = this.smooth[i]
      const v = prev
        ? { x: prev.x + SMOOTHING * (raw.x - prev.x), y: prev.y + SMOOTHING * (raw.y - prev.y) }
        : raw
      this.smooth[i] = v
      return v
    }

    const pts = {
      nose: p(NOSE),
      ls: p(L_SHOULDER),
      rs: p(R_SHOULDER),
      le: p(L_ELBOW),
      re: p(R_ELBOW),
      lw: p(L_WRIST),
      rw: p(R_WRIST),
      lh: p(L_HIP),
      rh: p(R_HIP),
    }

    // Body scale: torso length when hips are visible, otherwise keep the last estimate
    // (falling back to arm length on the very first frames).
    const shoulders = pts.ls && pts.rs ? mid(pts.ls, pts.rs) : (pts.ls ?? pts.rs)
    const hips = pts.lh && pts.rh ? mid(pts.lh, pts.rh) : (pts.lh ?? pts.rh)
    let s = 0
    if (shoulders && hips) s = len(sub(shoulders, hips))
    else if (pts.ls && pts.le && pts.lw) s = len(sub(pts.ls, pts.le)) + len(sub(pts.le, pts.lw))
    if (s > 0) this.scale = this.scale ? this.scale * 0.9 + s * 0.1 : s
    if (!this.scale) return []

    // In profile the nose sits ahead of the shoulders: that tells us which way is "forward".
    if (pts.nose && shoulders) {
      const f = Math.sign(pts.nose.x - shoulders.x)
      this.facingAvg = this.facingAvg * 0.95 + f * 0.05
    }

    const out: PunchEvent[] = []
    const mpArms: [Hand, Vec | null, Vec | null, Vec | null][] = [
      ['left', pts.ls, pts.le, pts.lw],
      ['right', pts.rs, pts.re, pts.rw],
    ]
    for (const [mpHand, sh, el, wr] of mpArms) {
      const hand: Hand = this.config.swapHands ? (mpHand === 'left' ? 'right' : 'left') : mpHand
      this.visible[hand] = !!(sh && el && wr)
      if (!sh || !el || !wr) {
        this.arms[hand].prevRel = null
        this.arms[hand].moving = false
        continue
      }
      const ev = this.updateArm(hand, sh, el, wr, tMs)
      if (ev) out.push(ev)
    }
    return out
  }

  private updateArm(hand: Hand, sh: Vec, el: Vec, wr: Vec, t: number): PunchEvent | null {
    const a = this.arms[hand]
    const rel = { x: (wr.x - sh.x) / this.scale, y: (wr.y - sh.y) / this.scale }
    const elbow = angleDeg(sh, el, wr)
    a.elbow = elbow

    if (!a.prevRel) {
      a.prevRel = rel
      a.prevT = t
      return null
    }
    const dt = (t - a.prevT) / 1000
    if (dt <= 0) return null
    const speed = len(sub(rel, a.prevRel)) / dt
    a.speed = speed

    let event: PunchEvent | null = null

    if (!a.moving) {
      if (speed >= this.config.minSpeed && t - a.lastPunchT >= this.config.cooldownMs) {
        a.moving = true
        a.startRel = a.prevRel
        a.startT = a.prevT
        a.peakDist = 0
        this.trackPeak(a, rel, elbow)
      }
    } else {
      this.trackPeak(a, rel, elbow)
      const dist = len(sub(rel, a.startRel))
      const stopped = speed < this.config.minSpeed * 0.35
      const comingBack = a.peakDist > 0 && dist < a.peakDist * 0.8
      const tooLong = t - a.startT > MAX_PUNCH_MS
      if (stopped || comingBack || tooLong) {
        a.moving = false
        event = this.classify(hand, a, t)
        if (event) a.lastPunchT = t
      }
    }

    a.prevRel = rel
    a.prevT = t
    return event
  }

  private trackPeak(a: ArmState, rel: Vec, elbow: number) {
    const d = len(sub(rel, a.startRel))
    if (d > a.peakDist) {
      a.peakDist = d
      a.peakRel = rel
      a.peakElbow = elbow
      a.peakWristBelowShoulder = rel.y
    }
  }

  private classify(hand: Hand, a: ArmState, t: number): PunchEvent | null {
    const c = this.config
    const dist = a.peakDist
    if (dist < c.minDistance) return null
    if (t - a.startT < MIN_PUNCH_MS) return null

    const d = sub(a.peakRel, a.startRel)
    const forward = d.x * this.facing
    const up = -d.y // image y grows downward
    const extGain = len(a.peakRel) - len(a.startRel)

    const leadHand: Hand = c.stance === 'orthodox' ? 'left' : 'right'
    const lead = hand === leadHand
    // Wrist ends well below the shoulder line -> body shot.
    const body = a.peakWristBelowShoulder > 0.45

    if (up >= c.uppercutRatio * dist && up > Math.abs(forward) * 0.8) {
      return { t, hand, kind: 'uppercut', lead, body: false }
    }
    if (forward > 0.3 * dist) {
      if (a.peakElbow < c.hookElbowAngle) return { t, hand, kind: 'hook', lead, body }
      if (extGain > 0.1) return { t, hand, kind: 'straight', lead, body }
    }
    // Backwards / downward movement: hand returning to guard.
    return null
  }
}

import { describe, expect, it } from 'vitest'
import { DEFAULT_DETECTOR_CONFIG, PunchDetector } from './detector'
import { GUARD, frame, punchFrames, type Arm, type Pose } from './testPoses'
import { buildClassifier, calibrate, decodeLandmarks, encodeLandmarks, evaluate, extractClip, type ClipLabel, type TrainingClip } from './trainer'
import type { Hand } from './types'

const idle: Pose = { left: GUARD, right: GUARD }

/** A clip of one punch repeated, with guard pauses in between and small variations. */
function makeClip(hand: Hand, targets: Arm[], label: Partial<ClipLabel> = {}, expectedCount?: number): TrainingClip {
  const poses: Pose[] = [...Array(10).fill(idle)]
  for (const t of targets) poses.push(...punchFrames(hand, t), ...Array(8).fill(idle))
  return {
    createdAt: 0,
    name: 'test',
    label: { hand, kind: 'straight', body: false, ...label },
    expectedCount,
    aspect: 1,
    frames: poses.map((p, i) => ({ t: i * (1000 / 30), p: encodeLandmarks(frame(p)) })),
  }
}

const jitter = (base: Arm, n: number): Arm[] =>
  Array.from({ length: n }, (_, i) => ({ ...base, x: base.x + ((i % 3) - 1) * 0.04, y: base.y + ((i % 2) * 2 - 1) * 0.03 }))

const STRAIGHT: Arm = { x: 1.1, y: 0.05 }
// A hook as the camera sees it for this boxer: arm almost straight, rising - the heuristic calls it straight.
const ODD_HOOK: Arm = { x: 0.8, y: -0.3 }

describe('trainer', () => {
  it('round-trips landmarks through the compact clip encoding', () => {
    const clip = makeClip('left', [STRAIGHT])
    const det = new PunchDetector()
    const ev = clip.frames.flatMap((f) => det.update(decodeLandmarks(f.p), f.t, clip.aspect))
    expect(ev).toHaveLength(1)
    expect(decodeLandmarks(null)).toBeUndefined()
  })

  it('extracts one sample per punch of the labeled hand', () => {
    const r = extractClip(makeClip('left', jitter(STRAIGHT, 6)), DEFAULT_DETECTOR_CONFIG)
    expect(r.found).toBe(6)
    expect(r.other).toBe(0)
    expect(r.samples.filter((s) => s.kind === 'straight')).toHaveLength(6)
  })

  it('trims extra movements to the expected count, keeping the biggest', () => {
    const targets = [...jitter(STRAIGHT, 4), { x: 0.75, y: 0.1 }]
    const r = extractClip(makeClip('left', targets, {}, 4), DEFAULT_DETECTOR_CONFIG)
    expect(r.found).toBe(5)
    expect(r.targets).toHaveLength(4)
    expect(Math.min(...r.targets.map((c) => c.features.dist))).toBeGreaterThan(0.6)
  })

  it('learns a punch the heuristic gets wrong', () => {
    const clips = [
      makeClip('left', jitter(STRAIGHT, 6)),
      makeClip('left', jitter(ODD_HOOK, 6), { kind: 'hook' }),
      makeClip('left', jitter(ODD_HOOK, 5), { kind: 'hook' }),
      makeClip('left', jitter(STRAIGHT, 5)),
    ]
    const test = makeClip('left', [ODD_HOOK, STRAIGHT])

    const plain = new PunchDetector()
    expect(test.frames.flatMap((f) => plain.update(decodeLandmarks(f.p), f.t)).map((e) => e.kind)).toEqual(['straight', 'straight'])

    const trained = new PunchDetector()
    trained.classifier = buildClassifier(clips, DEFAULT_DETECTOR_CONFIG).classifier
    expect(test.frames.flatMap((f) => trained.update(decodeLandmarks(f.p), f.t)).map((e) => e.kind)).toEqual(['hook', 'straight'])

    const ev = evaluate(clips, DEFAULT_DETECTOR_CONFIG)
    expect(ev.total).toBe(22)
    expect(ev.model).toBe(22)
    expect(ev.heuristic).toBe(11)
  })

  it('keeps the heuristic for kinds and hands it was not trained on', () => {
    const clips = [makeClip('left', jitter(ODD_HOOK, 6), { kind: 'hook' })]
    const det = new PunchDetector()
    det.classifier = buildClassifier(clips, DEFAULT_DETECTOR_CONFIG).classifier
    const test = makeClip('right', [STRAIGHT, { x: 0.35, y: -0.55 }])
    expect(test.frames.flatMap((f) => det.update(decodeLandmarks(f.p), f.t)).map((e) => e.kind)).toEqual(['straight', 'uppercut'])
  })

  it('calibrates thresholds to the counted punches', async () => {
    const clips = [makeClip('left', jitter(STRAIGHT, 6), {}, 6)]
    const strict = { ...DEFAULT_DETECTOR_CONFIG, minDistance: 0.95 }
    expect(extractClip(clips[0], strict).found).toBe(0)
    const cal = await calibrate(clips, strict)
    expect(cal).not.toBeNull()
    expect(cal!.errorBefore).toBe(6)
    expect(cal!.errorAfter).toBe(0)
    expect(extractClip(clips[0], { ...strict, ...cal! }).found).toBe(6)
  })
})

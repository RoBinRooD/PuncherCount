import {
  PunchDetector,
  classifyHeuristic,
  type Classification,
  type Classifier,
  type DetectorConfig,
  type Landmark,
  type PunchCandidate,
  type PunchFeatures,
} from './detector'
import type { Hand, PunchKind } from './types'

/**
 * Learning punch types from labeled clips.
 *
 * A clip shows one punch (e.g. left jab) repeated several times. Its pose landmarks are
 * stored, not the video, so samples are re-extracted whenever the detector settings change.
 * Every outward movement of the labeled hand becomes a sample of that punch; movements of
 * the other (guarding) hand become "none" samples that teach the model what to ignore.
 * Classification is k-nearest-neighbours over standardized movement features.
 */

/** Landmarks kept from each frame (everything the detector reads). */
const TRACKED = [0, 11, 12, 13, 14, 15, 16, 23, 24]

export interface ClipLabel {
  hand: Hand
  kind: PunchKind
  body: boolean
}

export interface ClipFrame {
  /** ms since the start of the clip */
  t: number
  /** [x, y, visibility] for each TRACKED landmark, or null when no pose was found */
  p: number[] | null
}

export interface TrainingClip {
  id?: number
  createdAt: number
  /** last change to the label or count (for sync); defaults to createdAt */
  updatedAt?: number
  /** the original video on Google Drive, if it was uploaded */
  videoId?: string
  name: string
  label: ClipLabel
  /** how many punches the clip contains, if the user counted them */
  expectedCount?: number
  /** video width / height */
  aspect: number
  frames: ClipFrame[]
}

export function encodeLandmarks(lms: Landmark[] | undefined): number[] | null {
  if (!lms) return null
  const r = (v: number) => Math.round(v * 1e4) / 1e4
  return TRACKED.flatMap((i) => [r(lms[i].x), r(lms[i].y), r(lms[i].visibility ?? 1)])
}

export function decodeLandmarks(p: number[] | null): Landmark[] | undefined {
  if (!p) return undefined
  const lms: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }))
  TRACKED.forEach((idx, j) => (lms[idx] = { x: p[j * 3], y: p[j * 3 + 1], visibility: p[j * 3 + 2] }))
  return lms
}

export type SampleKind = PunchKind | 'none'

export interface Sample {
  hand: Hand
  kind: SampleKind
  body: boolean
  x: number[]
  clipIndex: number
}

export interface ClipResult {
  /** outward movements of the labeled hand (before trimming to expectedCount) */
  found: number
  /** movements of the other hand (should be ~0) */
  other: number
  /** labeled-hand movements kept as samples */
  targets: PunchCandidate[]
  samples: Sample[]
}

function vector(f: PunchFeatures): number[] {
  return [
    f.fwd,
    f.up,
    f.peakFwd,
    f.peakUp,
    f.startFwd,
    f.startUp,
    f.peakElbow / 60,
    f.startElbow / 60,
    f.extGain,
    f.durMs / 200,
    Math.min(f.path, 3),
  ]
}

function clipCandidates(clip: TrainingClip, config: DetectorConfig): PunchCandidate[] {
  const det = new PunchDetector(config)
  const out: PunchCandidate[] = []
  for (const fr of clip.frames) out.push(...det.candidates(decodeLandmarks(fr.p), fr.t, clip.aspect))
  return out
}

export function extractClip(clip: TrainingClip, config: DetectorConfig, clipIndex = 0): ClipResult {
  const all = clipCandidates(clip, config)
  let target = all.filter((c) => c.hand === clip.label.hand)
  const other = all.filter((c) => c.hand !== clip.label.hand)
  const found = target.length
  // More movements than punches: keep the biggest ones (small twitches are not the punch).
  const n = clip.expectedCount
  if (n && target.length > n) {
    const keep = new Set([...target].sort((a, b) => b.features.dist - a.features.dist).slice(0, n))
    target = target.filter((c) => keep.has(c))
  }
  const samples: Sample[] = [
    ...target.map((c) => ({ hand: c.hand, kind: clip.label.kind, body: clip.label.body, x: vector(c.features), clipIndex })),
    ...other.map((c) => ({ hand: c.hand, kind: 'none' as const, body: false, x: vector(c.features), clipIndex })),
  ]
  return { found, other: other.length, targets: target, samples }
}

export function extractAll(clips: TrainingClip[], config: DetectorConfig) {
  return clips.map((c, i) => extractClip(c, config, i))
}

const K = 5

export class ClipModel {
  private mean: number[]
  private std: number[]
  /** Typical nearest-neighbour distance between samples of the same kind (per hand). */
  private spread: Record<Hand, number> = { left: Infinity, right: Infinity }

  constructor(readonly samples: Sample[]) {
    const dims = samples[0]?.x.length ?? 0
    this.mean = Array.from({ length: dims }, (_, d) => avg(samples.map((s) => s.x[d])))
    this.std = Array.from({ length: dims }, (_, d) => {
      const m = this.mean[d]
      return Math.max(0.05, Math.sqrt(avg(samples.map((s) => (s.x[d] - m) ** 2))))
    })
    for (const hand of ['left', 'right'] as Hand[]) {
      const pool = samples.filter((s) => s.hand === hand)
      // Typical distance from a sample to its nearest same-kind neighbour.
      const nn = pool
        .map((s) => Math.min(...pool.filter((o) => o !== s && o.kind === s.kind).map((o) => this.dist(s.x, o.x))))
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
      if (nn.length >= 3) this.spread[hand] = nn[Math.floor((nn.length - 1) * 0.9)]
    }
  }

  private dist(a: number[], b: number[]) {
    let s = 0
    for (let d = 0; d < a.length; d++) s += ((a[d] - b[d]) / this.std[d]) ** 2
    return Math.sqrt(s)
  }

  /** Kinds (excluding "none") the model has examples of for this hand. */
  kinds(hand: Hand): Set<PunchKind> {
    const out = new Set<PunchKind>()
    for (const s of this.samples) if (s.hand === hand && s.kind !== 'none') out.add(s.kind)
    return out
  }

  private vote(pool: Sample[], x: number[]) {
    const near = pool
      .map((s) => ({ s, d: this.dist(x, s.x) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, K)
    const score = new Map<string, number>()
    for (const { s, d } of near) score.set(String(s.kind), (score.get(String(s.kind)) ?? 0) + 1 / (d + 0.1))
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0]
    return { kind: best[0] as SampleKind, nearest: near[0].d, near }
  }

  /**
   * Classify a movement. Falls back to `fallback` (the heuristic) when this hand has too few
   * samples, when the movement is far from every trained example, or when it is not close
   * to one and the heuristic sees a kind the model was never shown.
   */
  classify(c: PunchCandidate, fallback: Classification | null): Classification | null {
    const pool = this.samples.filter((s) => s.hand === c.hand)
    if (pool.filter((s) => s.kind !== 'none').length < 3) return fallback

    const x = vector(c.features)
    const v = this.vote(pool, x)
    const spread = this.spread[c.hand]
    if (v.nearest > spread * 2 + 0.5) return fallback
    if (fallback && !this.kinds(c.hand).has(fallback.kind) && v.nearest > spread + 0.25) return fallback
    if (v.kind === 'none') return null
    const kind = v.kind

    // Body vs head: learn it only if both were recorded for this punch.
    const kindPool = pool.filter((s) => s.kind === kind)
    const hasBoth = kindPool.some((s) => s.body) && kindPool.some((s) => !s.body)
    let body: boolean
    if (hasBoth) {
      const near = kindPool
        .map((s) => ({ s, d: this.dist(x, s.x) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, K)
      body = near.filter((n) => n.s.body).length * 2 > near.length
    } else {
      body = kind === 'uppercut' ? false : (fallback?.body ?? c.features.peakUp < -0.45)
    }
    return { kind, body }
  }
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

export function buildClassifier(clips: TrainingClip[], config: DetectorConfig): { classifier: Classifier; samples: number } {
  const samples = extractAll(clips, config).flatMap((r) => r.samples)
  if (!samples.some((s) => s.kind !== 'none')) return { classifier: classifyHeuristic, samples: 0 }
  const model = new ClipModel(samples)
  return {
    classifier: (c, cfg) => model.classify(c, classifyHeuristic(c, cfg)),
    samples: samples.filter((s) => s.kind !== 'none').length,
  }
}

export interface Evaluation {
  /** labeled punches evaluated */
  total: number
  /** correctly typed by the trained model (leave-one-clip-out) */
  model: number
  /** correctly typed by the built-in heuristic */
  heuristic: number
}

/**
 * Leave-one-clip-out accuracy: each clip is classified by a model trained on the other
 * clips, so the score reflects how well it does on new footage.
 */
export function evaluate(clips: TrainingClip[], config: DetectorConfig): Evaluation {
  const results = extractAll(clips, config)
  const ev: Evaluation = { total: 0, model: 0, heuristic: 0 }
  clips.forEach((clip, i) => {
    const train = results.filter((_, j) => j !== i).flatMap((r) => r.samples)
    const model = train.some((s) => s.kind !== 'none') ? new ClipModel(train) : null
    for (const c of results[i].targets) {
      const h = classifyHeuristic(c, config)
      const m = model ? model.classify(c, h) : h
      ev.total++
      if (h?.kind === clip.label.kind) ev.heuristic++
      if (m?.kind === clip.label.kind) ev.model++
    }
  })
  return ev
}

export interface Calibration {
  minSpeed: number
  minDistance: number
  /** total miscount over clips with a known punch count, before / after */
  errorBefore: number
  errorAfter: number
  clips: number
}

function countError(clips: TrainingClip[], frames: (Landmark[] | undefined)[][], config: DetectorConfig) {
  let err = 0
  clips.forEach((clip, i) => {
    const det = new PunchDetector(config)
    let target = 0
    let other = 0
    frames[i].forEach((lms, j) => {
      for (const c of det.candidates(lms, clip.frames[j].t, clip.aspect)) c.hand === clip.label.hand ? target++ : other++
    })
    err += Math.abs(target - (clip.expectedCount ?? 0)) + other * 0.5
  })
  return err
}

/**
 * Grid-search the speed and distance thresholds so the number of movements found in each
 * clip matches the punch count the user entered. Yields to the UI between rows.
 */
export async function calibrate(clips: TrainingClip[], config: DetectorConfig): Promise<Calibration | null> {
  const counted = clips.filter((c) => c.expectedCount)
  if (counted.length === 0) return null
  const frames = counted.map((c) => c.frames.map((f) => decodeLandmarks(f.p)))
  const errorBefore = countError(counted, frames, config)
  let best = { minSpeed: config.minSpeed, minDistance: config.minDistance, err: errorBefore, away: 0 }
  for (let speed = 1; speed <= 4.01; speed += 0.25) {
    for (let distance = 0.15; distance <= 0.61; distance += 0.03) {
      const err = countError(counted, frames, { ...config, minSpeed: speed, minDistance: distance })
      // On ties prefer values close to the current ones.
      const away = Math.abs(speed - config.minSpeed) / 3 + Math.abs(distance - config.minDistance) / 0.45
      if (err < best.err - 1e-9 || (Math.abs(err - best.err) < 1e-9 && away < best.away))
        best = { minSpeed: round2(speed), minDistance: round2(distance), err, away }
    }
    await new Promise((r) => setTimeout(r, 0))
  }
  return { minSpeed: best.minSpeed, minDistance: best.minDistance, errorBefore, errorAfter: best.err, clips: counted.length }
}

const round2 = (v: number) => Math.round(v * 100) / 100

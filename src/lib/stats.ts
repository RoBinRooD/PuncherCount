import { PUNCH_TYPES, punchType, type Hand, type PunchEvent, type PunchType, type SessionRecord } from './types'

export interface Tally {
  total: number
  hand: Record<Hand, number>
  type: Record<PunchType, number>
  body: number
}

export function emptyTally(): Tally {
  return {
    total: 0,
    hand: { left: 0, right: 0 },
    type: { jab: 0, cross: 0, hook: 0, uppercut: 0 },
    body: 0,
  }
}

export function addToTally(t: Tally, p: PunchEvent): Tally {
  t.total++
  t.hand[p.hand]++
  t.type[punchType(p)]++
  if (p.body) t.body++
  return t
}

export function tally(punches: PunchEvent[]): Tally {
  return punches.reduce(addToTally, emptyTally())
}

export function sessionPunches(s: SessionRecord) {
  return s.rounds.flatMap((r) => r.punches)
}

export function sessionWorkMs(s: SessionRecord) {
  return s.rounds.reduce((a, r) => a + r.durationMs, 0)
}

/** Punches per minute over the given working time. */
export const ppm = (count: number, ms: number) => (ms > 0 ? (count / ms) * 60000 : 0)

/** Punch counts per `bucketSec` across a round. */
export function timeline(punches: PunchEvent[], durationMs: number, bucketSec = 10) {
  const n = Math.max(1, Math.ceil(durationMs / (bucketSec * 1000)))
  const left = new Array(n).fill(0)
  const right = new Array(n).fill(0)
  for (const p of punches) {
    const i = Math.min(n - 1, Math.floor(p.t / (bucketSec * 1000)))
    ;(p.hand === 'left' ? left : right)[i]++
  }
  return { labels: left.map((_, i) => `${i * bucketSec}s`), left, right }
}

export { PUNCH_TYPES }

export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function formatDate(ts: number) {
  return new Date(ts).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

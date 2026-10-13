export type Hand = 'left' | 'right'
export type PunchKind = 'straight' | 'hook' | 'uppercut'
export type Stance = 'orthodox' | 'southpaw'

/** Display category: straight punches are split into jab (lead) and cross (rear). */
export type PunchType = 'jab' | 'cross' | 'hook' | 'uppercut'

export interface PunchEvent {
  /** ms since the start of the round */
  t: number
  hand: Hand
  kind: PunchKind
  lead: boolean
  body: boolean
}

export interface RoundRecord {
  index: number
  durationMs: number
  punches: PunchEvent[]
}

export interface SessionRecord {
  id?: number
  startedAt: number
  endedAt: number
  stance: Stance
  plan: { rounds: number; workSec: number; restSec: number }
  rounds: RoundRecord[]
}

export function punchType(p: Pick<PunchEvent, 'kind' | 'lead'>): PunchType {
  if (p.kind === 'straight') return p.lead ? 'jab' : 'cross'
  return p.kind
}

export const PUNCH_TYPES: PunchType[] = ['jab', 'cross', 'hook', 'uppercut']

export const PUNCH_LABEL: Record<PunchType, string> = {
  jab: 'แย็บ (Jab)',
  cross: 'หมัดตรง (Cross)',
  hook: 'ฮุก (Hook)',
  uppercut: 'อัปเปอร์คัต (Uppercut)',
}

export const HAND_LABEL: Record<Hand, string> = { left: 'ซ้าย', right: 'ขวา' }

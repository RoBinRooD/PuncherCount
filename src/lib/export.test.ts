import { describe, expect, it } from 'vitest'
import { parseBackup } from './export'

const session = { startedAt: 1, endedAt: 2, stance: 'orthodox', plan: { rounds: 1, workSec: 60, restSec: 0 }, rounds: [] }
const clip = { createdAt: 3, name: 'a.mp4', label: { hand: 'left', kind: 'hook', body: false }, aspect: 1, frames: [] }

describe('parseBackup', () => {
  it('reads the current format with sessions and clips', () => {
    const b = parseBackup({ app: 'puncher-count', version: 2, sessions: [session], clips: [clip] })
    expect(b.sessions).toHaveLength(1)
    expect(b.clips).toHaveLength(1)
  })

  it('reads the old plain session array', () => {
    expect(parseBackup([session])).toEqual({ sessions: [session], clips: [] })
  })

  it('drops malformed entries and rejects unrelated files', () => {
    const b = parseBackup({ sessions: [session, { foo: 1 }], clips: [clip, { ...clip, label: { hand: 'up', kind: 'hook' } }, null] })
    expect(b.sessions).toHaveLength(1)
    expect(b.clips).toHaveLength(1)
    expect(() => parseBackup({ hello: 'world' })).toThrow()
    expect(() => parseBackup(null)).toThrow()
  })
})

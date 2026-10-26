import { describe, expect, it } from 'vitest'
import { planSync, type SyncIndex } from './sync'
import type { SessionRecord } from './types'
import type { TrainingClip } from './trainer'

const session = (startedAt: number, id?: number): SessionRecord => ({
  id,
  startedAt,
  endedAt: startedAt + 1,
  stance: 'orthodox',
  plan: { rounds: 1, workSec: 60, restSec: 0 },
  rounds: [],
})

const clip = (createdAt: number, updatedAt = createdAt, id?: number): TrainingClip => ({
  id,
  createdAt,
  updatedAt,
  name: `${createdAt}.mp4`,
  label: { hand: 'left', kind: 'straight', body: false },
  aspect: 1,
  frames: [],
})

const index = (p: Partial<SyncIndex> = {}): SyncIndex => ({ version: 1, sessions: [], deletedSessions: [], deletedClips: [], ...p })
const none = { sessions: [], clips: [] }

describe('planSync', () => {
  it('uploads everything on the first sync', () => {
    const plan = planSync({
      localSessions: [session(1, 10)],
      localClips: [clip(5, 5, 20)],
      remoteIndex: null,
      remoteClips: [],
      pending: none,
    })
    expect(plan.uploadClips.map((c) => c.createdAt)).toEqual([5])
    expect(plan.index?.sessions).toEqual([session(1)])
    expect(plan.index?.sessions[0]).not.toHaveProperty('id')
    expect(plan.addSessions).toEqual([])
  })

  it('merges sessions from both sides', () => {
    const plan = planSync({
      localSessions: [session(1, 10)],
      localClips: [],
      remoteIndex: index({ sessions: [session(2)] }),
      remoteClips: [],
      pending: none,
    })
    expect(plan.addSessions.map((s) => s.startedAt)).toEqual([2])
    expect(plan.index?.sessions.map((s) => s.startedAt)).toEqual([1, 2])
  })

  it('does nothing when both sides match', () => {
    const plan = planSync({
      localSessions: [session(1, 10)],
      localClips: [clip(5, 7, 20)],
      remoteIndex: index({ sessions: [session(1)] }),
      remoteClips: [{ fileId: 'f', key: '5', updatedAt: 7 }],
      pending: none,
    })
    expect(plan).toEqual({ addSessions: [], deleteSessionIds: [], uploadClips: [], downloadClips: [], deleteClipIds: [], trashClips: [], index: null })
  })

  it('keeps the newer copy of an edited clip', () => {
    const plan = planSync({
      localSessions: [],
      localClips: [clip(5, 9, 20), clip(6, 6, 21)],
      remoteIndex: index(),
      remoteClips: [
        { fileId: 'a', key: '5', updatedAt: 7 },
        { fileId: 'b', key: '6', updatedAt: 8 },
        { fileId: 'c', key: '7', updatedAt: 7 },
      ],
      pending: none,
    })
    expect(plan.uploadClips.map((c) => c.createdAt)).toEqual([5])
    expect(plan.downloadClips.map((r) => r.fileId)).toEqual(['b', 'c'])
  })

  it('applies deletions from this device and from others', () => {
    const plan = planSync({
      localSessions: [session(1, 10), session(2, 11)],
      localClips: [clip(5, 5, 20), clip(6, 6, 21)],
      remoteIndex: index({ sessions: [session(1), session(2), session(3)], deletedSessions: [2], deletedClips: ['6'] }),
      remoteClips: [
        { fileId: 'a', key: '5', updatedAt: 5 },
        { fileId: 'b', key: '6', updatedAt: 6 },
      ],
      pending: { sessions: [3], clips: ['5'] },
    })
    expect(plan.deleteSessionIds).toEqual([11])
    expect(plan.addSessions).toEqual([])
    expect(plan.deleteClipIds.sort()).toEqual([20, 21])
    expect(plan.trashClips.map((r) => r.fileId).sort()).toEqual(['a', 'b'])
    expect(plan.uploadClips).toEqual([])
    expect(plan.index?.sessions.map((s) => s.startedAt)).toEqual([1])
    expect(plan.index?.deletedSessions.sort()).toEqual([2, 3])
    expect(plan.index?.deletedClips.sort()).toEqual(['5', '6'])
  })
})

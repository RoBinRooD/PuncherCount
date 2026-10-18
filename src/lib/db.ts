import Dexie, { type EntityTable } from 'dexie'
import type { SessionRecord } from './types'
import type { TrainingClip } from './trainer'
import type { Backup } from './export'

const db = new Dexie('puncher-count') as Dexie & {
  sessions: EntityTable<SessionRecord, 'id'>
  clips: EntityTable<TrainingClip, 'id'>
}
db.version(1).stores({ sessions: '++id, startedAt' })
db.version(2).stores({ sessions: '++id, startedAt', clips: '++id, createdAt' })

export { db }

export const saveSession = (s: SessionRecord) => db.sessions.add(s)
export const deleteSession = (id: number) => db.sessions.delete(id)
export const getSession = (id: number) => db.sessions.get(id)
export const listSessions = () => db.sessions.orderBy('startedAt').reverse().toArray()

export const saveClip = (c: TrainingClip) => db.clips.add(c)
export const deleteClip = (id: number) => db.clips.delete(id)
export const listClips = () => db.clips.orderBy('createdAt').toArray()

/** Add the sessions and clips from a backup that aren't already here. Returns how many were added. */
export async function importBackup(backup: Backup): Promise<{ sessions: number; clips: number }> {
  const haveSessions = new Set((await db.sessions.toArray()).map((s) => s.startedAt))
  const freshSessions = backup.sessions
    .filter((s) => !haveSessions.has(s.startedAt))
    .map(({ id: _id, ...rest }) => rest as SessionRecord)
  const clipKey = (c: TrainingClip) => `${c.createdAt}|${c.name}`
  const haveClips = new Set((await db.clips.toArray()).map(clipKey))
  const freshClips = backup.clips
    .filter((c) => !haveClips.has(clipKey(c)))
    .map(({ id: _id, ...rest }) => rest as TrainingClip)
  await db.transaction('rw', db.sessions, db.clips, async () => {
    await db.sessions.bulkAdd(freshSessions)
    await db.clips.bulkAdd(freshClips)
  })
  return { sessions: freshSessions.length, clips: freshClips.length }
}

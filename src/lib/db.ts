import Dexie, { type EntityTable } from 'dexie'
import type { SessionRecord } from './types'
import type { TrainingClip } from './trainer'
import type { Backup } from './export'
import { clipKey, type Tombstones } from './sync'

const db = new Dexie('puncher-count') as Dexie & {
  sessions: EntityTable<SessionRecord, 'id'>
  clips: EntityTable<TrainingClip, 'id'>
}
db.version(1).stores({ sessions: '++id, startedAt' })
db.version(2).stores({ sessions: '++id, startedAt', clips: '++id, createdAt' })

export { db }

/** Fired after every local change so the Drive sync can follow up. */
export const localChanges = new EventTarget()
const changed = <T>(result: T): T => {
  localChanges.dispatchEvent(new Event('change'))
  return result
}

// Deletions waiting to be recorded on Drive (see sync.ts).
const TOMBSTONES = 'puncher-count:pending-deletes'

export function pendingDeletes(): Tombstones {
  try {
    const t = JSON.parse(localStorage.getItem(TOMBSTONES) ?? '')
    return { sessions: t.sessions ?? [], clips: t.clips ?? [] }
  } catch {
    return { sessions: [], clips: [] }
  }
}

export function clearPendingDeletes(sent: Tombstones) {
  const t = pendingDeletes()
  savePendingDeletes({
    sessions: t.sessions.filter((s) => !sent.sessions.includes(s)),
    clips: t.clips.filter((c) => !sent.clips.includes(c)),
  })
}

function savePendingDeletes(t: Tombstones) {
  try {
    localStorage.setItem(TOMBSTONES, JSON.stringify(t))
  } catch {
    // storage unavailable - the deletion just won't reach Drive
  }
}

export const saveSession = async (s: SessionRecord) => changed(await db.sessions.add(s))
export async function deleteSession(id: number) {
  const s = await db.sessions.get(id)
  if (s) {
    const t = pendingDeletes()
    savePendingDeletes({ ...t, sessions: [...t.sessions, s.startedAt] })
  }
  return changed(await db.sessions.delete(id))
}
export const getSession = (id: number) => db.sessions.get(id)
export const listSessions = () => db.sessions.orderBy('startedAt').reverse().toArray()

export const saveClip = async (c: TrainingClip) => changed((await db.clips.add({ ...c, updatedAt: Date.now() })) as number)
export async function deleteClip(id: number) {
  const c = await db.clips.get(id)
  if (c) {
    const t = pendingDeletes()
    savePendingDeletes({ ...t, clips: [...t.clips, clipKey(c)] })
  }
  return changed(await db.clips.delete(id))
}
export const updateClip = async (id: number, patch: Partial<TrainingClip>) =>
  changed(await db.clips.update(id, { ...patch, updatedAt: Date.now() }))
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
  return changed({ sessions: freshSessions.length, clips: freshClips.length })
}

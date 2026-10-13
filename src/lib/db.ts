import Dexie, { type EntityTable } from 'dexie'
import type { SessionRecord } from './types'

const db = new Dexie('puncher-count') as Dexie & {
  sessions: EntityTable<SessionRecord, 'id'>
}
db.version(1).stores({ sessions: '++id, startedAt' })

export { db }

export const saveSession = (s: SessionRecord) => db.sessions.add(s)
export const deleteSession = (id: number) => db.sessions.delete(id)
export const getSession = (id: number) => db.sessions.get(id)
export const listSessions = () => db.sessions.orderBy('startedAt').reverse().toArray()

export async function importSessions(list: SessionRecord[]): Promise<number> {
  const existing = new Set((await db.sessions.toArray()).map((s) => s.startedAt))
  const fresh = list
    .filter((s) => s && typeof s.startedAt === 'number' && Array.isArray(s.rounds))
    .filter((s) => !existing.has(s.startedAt))
    .map(({ id: _id, ...rest }) => rest as SessionRecord)
  await db.sessions.bulkAdd(fresh)
  return fresh.length
}

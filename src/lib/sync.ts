import type { SessionRecord } from './types'
import type { TrainingClip } from './trainer'

/**
 * Two-way merge between this browser and the Google Drive folder.
 *
 * Drive holds `index.json` (all sessions plus the keys of deleted records) and one JSON file
 * per clip. Sessions never change after saving, so they merge by `startedAt`. Clips can be
 * relabeled, so the newer `updatedAt` wins. Deletions are kept as tombstones so a record
 * deleted on one device doesn't come back from another.
 */

export interface SyncIndex {
  version: 1
  sessions: SessionRecord[]
  deletedSessions: number[]
  deletedClips: string[]
}

export interface Tombstones {
  sessions: number[]
  clips: string[]
}

/** A clip file on Drive, from its metadata (appProperties) without downloading it. */
export interface RemoteClip {
  fileId: string
  key: string
  updatedAt: number
}

export const clipKey = (c: Pick<TrainingClip, 'createdAt'>) => String(c.createdAt)
export const clipUpdatedAt = (c: Pick<TrainingClip, 'createdAt' | 'updatedAt'>) => c.updatedAt ?? c.createdAt

export interface SyncPlan {
  /** sessions on Drive missing here */
  addSessions: SessionRecord[]
  /** local session ids deleted elsewhere */
  deleteSessionIds: number[]
  /** local clips that are new or newer than Drive's copy */
  uploadClips: TrainingClip[]
  /** Drive clips that are new or newer than ours */
  downloadClips: RemoteClip[]
  /** local clip ids deleted elsewhere */
  deleteClipIds: number[]
  /** Drive clip files to move to the trash */
  trashClips: RemoteClip[]
  /** the index to write back, or null if Drive's copy is already up to date */
  index: SyncIndex | null
}

const strip = ({ id: _id, ...s }: SessionRecord): SessionRecord => s

export function planSync(p: {
  localSessions: SessionRecord[]
  localClips: TrainingClip[]
  remoteIndex: SyncIndex | null
  remoteClips: RemoteClip[]
  pending: Tombstones
}): SyncPlan {
  const remote = p.remoteIndex ?? { version: 1, sessions: [], deletedSessions: [], deletedClips: [] }
  const deletedSessions = new Set([...remote.deletedSessions, ...p.pending.sessions])
  const deletedClips = new Set([...remote.deletedClips, ...p.pending.clips])

  const localByStart = new Map(p.localSessions.map((s) => [s.startedAt, s]))
  const remoteStarts = new Set(remote.sessions.map((s) => s.startedAt))
  const addSessions = remote.sessions.filter((s) => !localByStart.has(s.startedAt) && !deletedSessions.has(s.startedAt))
  const deleteSessionIds = p.localSessions.filter((s) => deletedSessions.has(s.startedAt) && s.id !== undefined).map((s) => s.id!)

  const merged = new Map<number, SessionRecord>()
  for (const s of [...remote.sessions, ...p.localSessions]) if (!deletedSessions.has(s.startedAt)) merged.set(s.startedAt, strip(s))
  const sessions = [...merged.values()].sort((a, b) => a.startedAt - b.startedAt)

  const remoteByKey = new Map(p.remoteClips.map((r) => [r.key, r]))
  const localByKey = new Map(p.localClips.map((c) => [clipKey(c), c]))
  const uploadClips = p.localClips.filter((c) => {
    if (deletedClips.has(clipKey(c))) return false
    const r = remoteByKey.get(clipKey(c))
    return !r || clipUpdatedAt(c) > r.updatedAt
  })
  const downloadClips = p.remoteClips.filter((r) => {
    if (deletedClips.has(r.key)) return false
    const c = localByKey.get(r.key)
    return !c || r.updatedAt > clipUpdatedAt(c)
  })
  const deleteClipIds = p.localClips.filter((c) => deletedClips.has(clipKey(c)) && c.id !== undefined).map((c) => c.id!)
  const trashClips = p.remoteClips.filter((r) => deletedClips.has(r.key))

  const changed =
    !p.remoteIndex ||
    sessions.length !== remoteStarts.size ||
    sessions.some((s) => !remoteStarts.has(s.startedAt)) ||
    deletedSessions.size !== remote.deletedSessions.length ||
    deletedClips.size !== remote.deletedClips.length
  const index: SyncIndex | null = changed
    ? { version: 1, sessions, deletedSessions: [...deletedSessions], deletedClips: [...deletedClips] }
    : null

  return { addSessions, deleteSessionIds, uploadClips, downloadClips, deleteClipIds, trashClips, index }
}

import { useSyncExternalStore } from 'react'
import { clearPendingDeletes, db, localChanges, pendingDeletes, updateClip } from './db'
import { NeedsSignIn, ensureFolder, hasToken, listFolder, readJson, signIn, signOut, trash, uploadFile, writeJson } from './drive'
import { clipKey, clipUpdatedAt, planSync, type RemoteClip, type SyncIndex } from './sync'
import type { TrainingClip } from './trainer'

/** Google Drive sync state shared by every page. */
export interface CloudStatus {
  /** the user turned Drive sync on (it stays on across reloads, the token doesn't) */
  connected: boolean
  state: 'idle' | 'syncing' | 'signin' | 'error'
  lastSync?: number
  message?: string
  /** bumped whenever a sync changed local data, so pages know to reload */
  revision: number
  upload?: { name: string; progress: number }
}

const KEY = 'puncher-count:drive'

let status: CloudStatus = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { connected: !!s.connected, lastSync: s.lastSync, state: 'idle', revision: 0 }
  } catch {
    return { connected: false, state: 'idle', revision: 0 }
  }
})()

const listeners = new Set<() => void>()

function set(patch: Partial<CloudStatus>) {
  status = { ...status, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify({ connected: status.connected, lastSync: status.lastSync }))
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

export function useCloud(): CloudStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => status,
  )
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** First connection: shows Google's sign-in/consent popup. Call from a tap. */
export async function connect(clientId: string) {
  await signIn(clientId)
  set({ connected: true })
  await syncNow()
}

/** Get a fresh token after the old one expired (tokens last about an hour). Call from a tap. */
export async function resume(clientId: string) {
  try {
    await signIn(clientId)
  } catch (e) {
    set({ state: 'signin', message: errorMessage(e) })
    return
  }
  await syncNow()
}

export function disconnect() {
  signOut()
  set({ connected: false, state: 'idle', message: undefined })
}

let running: Promise<void> | null = null
let again = false

export function syncNow(): Promise<void> {
  if (!status.connected) return Promise.resolve()
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      await syncOnce()
    } while (again)
  })()
    .catch((e) => set(e instanceof NeedsSignIn ? { state: 'signin', message: undefined } : { state: 'error', message: errorMessage(e) }))
    .finally(() => (running = null))
  return running
}

async function syncOnce() {
  if (!hasToken()) throw new NeedsSignIn()
  set({ state: 'syncing', message: undefined })

  const folder = await ensureFolder()
  const files = await listFolder(folder)
  const indexFile = files.find((f) => f.appProperties?.pc === 'index')
  const remoteIndex = indexFile ? await readJson<SyncIndex>(indexFile.id) : null
  const remoteClips: RemoteClip[] = files
    .filter((f) => f.appProperties?.pc === 'clip' && f.appProperties.key)
    .map((f) => ({ fileId: f.id, key: f.appProperties!.key, updatedAt: Number(f.appProperties!.updatedAt) || 0 }))
  const pending = pendingDeletes()

  const plan = planSync({
    localSessions: await db.sessions.toArray(),
    localClips: await db.clips.toArray(),
    remoteIndex,
    remoteClips,
    pending,
  })

  // Local writes go straight to Dexie: they must not count as new local changes.
  let localChanged = plan.addSessions.length + plan.deleteSessionIds.length + plan.deleteClipIds.length > 0
  await db.sessions.bulkAdd(plan.addSessions.map(({ id: _id, ...s }) => s))
  await db.sessions.bulkDelete(plan.deleteSessionIds)
  await db.clips.bulkDelete(plan.deleteClipIds)
  for (const r of plan.downloadClips) {
    const { id: _id, ...clip } = await readJson<TrainingClip>(r.fileId)
    const existing = await db.clips.where('createdAt').equals(clip.createdAt).first()
    if (existing) await db.clips.put({ ...clip, id: existing.id })
    else await db.clips.add(clip)
    localChanged = true
  }

  const remoteByKey = new Map(remoteClips.map((r) => [r.key, r]))
  for (const c of plan.uploadClips) {
    const { id: _id, ...clip } = c
    const key = clipKey(c)
    const props = { pc: 'clip', key, updatedAt: String(clipUpdatedAt(c)) }
    await writeJson(folder, `clip-${key}.json`, clip, props, remoteByKey.get(key)?.fileId)
  }
  const trashed = new Set(plan.trashClips.map((r) => r.key))
  for (const f of files) {
    const p = f.appProperties
    if ((p?.pc === 'clip' || p?.pc === 'video') && trashed.has(p.key)) await trash(f.id)
  }
  if (plan.index) await writeJson(folder, 'index.json', plan.index, { pc: 'index' }, indexFile?.id)
  clearPendingDeletes(pending)

  set({ state: 'idle', lastSync: Date.now(), revision: status.revision + (localChanged ? 1 : 0) })
}

let uploads: Promise<void> = Promise.resolve()

/**
 * Queue the upload of a clip's original video next to its data (one at a time, so several
 * large videos don't compete for a phone's connection). Skipped when not signed in.
 */
export function uploadClipVideo(clipId: number, clip: TrainingClip, file: File, name: string): Promise<void> {
  uploads = uploads.then(() => uploadOne(clipId, clip, file, name))
  return uploads
}

async function uploadOne(clipId: number, clip: TrainingClip, file: File, name: string) {
  if (!status.connected || !hasToken()) return
  set({ upload: { name: file.name, progress: 0 } })
  try {
    const folder = await ensureFolder()
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''
    const id = await uploadFile(folder, file, `${name}${ext}`, { pc: 'video', key: clipKey(clip) }, (progress) =>
      set({ upload: { name: file.name, progress } }),
    )
    await updateClip(clipId, { videoId: id })
  } catch (e) {
    set(e instanceof NeedsSignIn ? { state: 'signin' } : { state: 'error', message: errorMessage(e) })
  } finally {
    set({ upload: undefined })
  }
}

let timer = 0

/** Start background sync: on launch, and shortly after every local change. */
export function startCloud() {
  if (status.connected) {
    if (hasToken()) void syncNow()
    else set({ state: 'signin' })
  }
  localChanges.addEventListener('change', () => {
    if (!status.connected) return
    if (!hasToken()) return set({ state: 'signin' })
    clearTimeout(timer)
    timer = window.setTimeout(() => void syncNow(), 1500)
  })
}

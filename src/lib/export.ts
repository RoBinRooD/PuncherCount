import { punchType, type SessionRecord } from './types'
import type { TrainingClip } from './trainer'

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const stamp = () => new Date().toISOString().slice(0, 10)

export interface Backup {
  sessions: SessionRecord[]
  clips: TrainingClip[]
}

export function exportJson(sessions: SessionRecord[], clips: TrainingClip[]) {
  // Compact: clip landmark frames would balloon with indentation.
  const backup = { app: 'puncher-count', version: 2, sessions, clips }
  download(`punchercount-${stamp()}.json`, JSON.stringify(backup), 'application/json')
}

/** Read a backup file: the current {sessions, clips} object or the older plain session array. */
export function parseBackup(data: unknown): Backup {
  const obj = (data ?? {}) as Partial<Record<keyof Backup, unknown>>
  const sessions = Array.isArray(data) ? data : Array.isArray(obj.sessions) ? obj.sessions : null
  const clips = Array.isArray(data) ? [] : Array.isArray(obj.clips) ? obj.clips : []
  if (!sessions) throw new Error('not a PuncherCount backup')
  return {
    sessions: sessions.filter((s) => s && typeof s.startedAt === 'number' && Array.isArray(s.rounds)),
    clips: clips.filter(
      (c) =>
        c &&
        typeof c.createdAt === 'number' &&
        typeof c.aspect === 'number' &&
        Array.isArray(c.frames) &&
        c.label &&
        ['left', 'right'].includes(c.label.hand) &&
        ['straight', 'hook', 'uppercut'].includes(c.label.kind),
    ),
  }
}

export function exportCsv(sessions: SessionRecord[]) {
  const rows = ['session_start,round,t_ms,hand,type,body']
  for (const s of sessions) {
    const start = new Date(s.startedAt).toISOString()
    for (const r of s.rounds)
      for (const p of r.punches) rows.push([start, r.index + 1, Math.round(p.t), p.hand, punchType(p), p.body].join(','))
  }
  download(`punchercount-${stamp()}.csv`, rows.join('\n'), 'text/csv')
}

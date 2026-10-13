import { punchType, type SessionRecord } from './types'

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const stamp = () => new Date().toISOString().slice(0, 10)

export function exportJson(sessions: SessionRecord[]) {
  download(`punchercount-${stamp()}.json`, JSON.stringify(sessions, null, 2), 'application/json')
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

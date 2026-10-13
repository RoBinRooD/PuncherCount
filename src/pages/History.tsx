import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar } from 'react-chartjs-2'
import { barStyle, stackedScales } from '../components/charts'
import { importSessions, listSessions } from '../lib/db'
import { exportCsv, exportJson } from '../lib/export'
import { formatDate, formatDuration, ppm, sessionPunches, sessionWorkMs, tally } from '../lib/stats'
import { HAND_COLOR } from '../lib/colors'
import type { SessionRecord } from '../lib/types'

export default function History() {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = () => listSessions().then(setSessions)
  useEffect(() => {
    void reload()
  }, [])

  const summary = useMemo(() => {
    if (!sessions) return null
    const weekAgo = Date.now() - 7 * 864e5
    const week = sessions.filter((s) => s.startedAt >= weekAgo)
    const all = tally(sessions.flatMap(sessionPunches))
    const workMs = sessions.reduce((a, s) => a + sessionWorkMs(s), 0)
    return {
      all,
      workMs,
      weekPunches: week.reduce((a, s) => a + sessionPunches(s).length, 0),
      weekSessions: week.length,
    }
  }, [sessions])

  const recent = useMemo(() => (sessions ?? []).slice(0, 15).reverse(), [sessions])

  const onImport = async (f: File | undefined) => {
    if (!f) return
    try {
      const n = await importSessions(JSON.parse(await f.text()))
      setMsg(`นำเข้า ${n} เซต`)
      void reload()
    } catch {
      setMsg('ไฟล์ไม่ถูกต้อง')
    }
  }

  if (!sessions || !summary) return null

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-3">
      <h1 className="text-xl font-bold">แดชบอร์ด</h1>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="7 วันล่าสุด" value={summary.weekPunches} unit="หมัด" sub={`${summary.weekSessions} เซต`} />
        <Stat label="หมัดทั้งหมด" value={summary.all.total} unit="หมัด" sub={`${sessions.length} เซต`} />
        <Stat label="เวลาชกรวม" value={formatDuration(summary.workMs)} unit="นาที" />
        <Stat label="เฉลี่ย" value={ppm(summary.all.total, summary.workMs).toFixed(0)} unit="หมัด/นาที" />
      </div>

      {summary.all.total > 0 && (
        <div className="rounded-2xl bg-panel p-3">
          <div className="mb-1 text-sm text-ink-2">สัดส่วนซ้าย / ขวา</div>
          <HandSplit left={summary.all.hand.left} right={summary.all.hand.right} />
        </div>
      )}

      {recent.length > 0 && (
        <div className="rounded-2xl bg-panel p-3">
          <div className="mb-2 text-sm text-ink-2">จำนวนหมัดต่อเซต (15 เซตล่าสุด)</div>
          <div className="h-56">
            <Bar
              data={{
                labels: recent.map((s) => new Date(s.startedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })),
                datasets: (['left', 'right'] as const).map((h) => ({
                  label: h === 'left' ? 'ซ้าย' : 'ขวา',
                  data: recent.map((s) => tally(sessionPunches(s)).hand[h]),
                  backgroundColor: HAND_COLOR[h],
                  ...barStyle,
                })),
              }}
              options={{ scales: stackedScales, interaction: { mode: 'index', intersect: false } }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">ประวัติ</h2>
        {sessions.length === 0 && <p className="text-sm text-ink-3">ยังไม่มีข้อมูล เริ่มซ้อมเซตแรกได้ที่แท็บ "ฝึกซ้อม"</p>}
        {sessions.map((s) => {
          const t = tally(sessionPunches(s))
          return (
            <Link key={s.id} to={`/session/${s.id}`} className="flex items-center justify-between rounded-xl bg-panel p-3">
              <div>
                <div className="text-sm">{formatDate(s.startedAt)}</div>
                <div className="text-xs text-ink-3">
                  {s.rounds.length} ยก · {formatDuration(sessionWorkMs(s))} นาที
                </div>
              </div>
              <div className="text-right">
                <div className="tabular text-lg font-bold">{t.total}</div>
                <div className="tabular text-xs text-ink-3">
                  ซ้าย {t.hand.left} · ขวา {t.hand.right}
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <button className="rounded-full bg-panel-2 px-4 py-2" onClick={() => exportJson(sessions)}>
          ส่งออก JSON (สำรองข้อมูล)
        </button>
        <button className="rounded-full bg-panel-2 px-4 py-2" onClick={() => exportCsv(sessions)}>
          ส่งออก CSV
        </button>
        <button className="rounded-full bg-panel-2 px-4 py-2" onClick={() => fileRef.current?.click()}>
          นำเข้า JSON
        </button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
      </div>
      {msg && <p className="text-sm text-ink-2">{msg}</p>}
    </div>
  )
}

export function Stat({ label, value, unit, sub }: { label: string; value: string | number; unit?: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-panel p-3">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="tabular text-2xl font-extrabold">
        {value} {unit && <span className="text-xs font-normal text-ink-3">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-ink-3">{sub}</div>}
    </div>
  )
}

export function HandSplit({ left, right }: { left: number; right: number }) {
  const total = left + right || 1
  const lp = Math.round((left / total) * 100)
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        <div style={{ width: `${lp}%`, background: HAND_COLOR.left }} />
        <div style={{ width: `${100 - lp}%`, background: HAND_COLOR.right }} />
      </div>
      <div className="tabular mt-1 flex justify-between text-sm">
        <span>
          ซ้าย {left} ({lp}%)
        </span>
        <span>
          ขวา {right} ({100 - lp}%)
        </span>
      </div>
    </div>
  )
}

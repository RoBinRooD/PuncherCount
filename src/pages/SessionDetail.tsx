import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Bar, Line } from 'react-chartjs-2'
import { barStyle, stackedScales } from '../components/charts'
import { deleteSession, getSession } from '../lib/db'
import { formatDate, formatDuration, ppm, sessionPunches, sessionWorkMs, tally, timeline } from '../lib/stats'
import { HAND_COLOR, TYPE_COLOR } from '../lib/colors'
import { PUNCH_LABEL, PUNCH_TYPES, punchType, type SessionRecord } from '../lib/types'
import { HandSplit, Stat } from './History'

export default function SessionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState<SessionRecord | null | undefined>(undefined)
  const [roundIdx, setRoundIdx] = useState(0)

  useEffect(() => {
    void getSession(Number(id)).then((s) => setSession(s ?? null))
  }, [id])

  const data = useMemo(() => {
    if (!session) return null
    const total = tally(sessionPunches(session))
    const rounds = session.rounds.map((r) => ({ ...r, tally: tally(r.punches) }))
    return { total, rounds, workMs: sessionWorkMs(session) }
  }, [session])

  if (session === undefined) return null
  if (!session || !data) return <p className="p-4 text-ink-2">ไม่พบข้อมูลเซตนี้</p>

  const round = data.rounds[Math.min(roundIdx, data.rounds.length - 1)]
  const tl = timeline(round.punches, round.durationMs, 10)

  const remove = async () => {
    if (!confirm('ลบเซตนี้?')) return
    await deleteSession(session.id!)
    navigate('/history')
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-3">
      <div>
        <button onClick={() => navigate('/history')} className="text-sm text-ink-3">
          ← แดชบอร์ด
        </button>
        <h1 className="text-xl font-bold">สรุปเซต</h1>
        <p className="text-sm text-ink-3">
          {formatDate(session.startedAt)} · {session.stance === 'orthodox' ? 'Orthodox' : 'Southpaw'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="หมัดทั้งหมด" value={data.total.total} unit="หมัด" />
        <Stat label="หมัดต่อนาที" value={ppm(data.total.total, data.workMs).toFixed(0)} unit="หมัด/นาที" />
        <Stat label="เวลาชก" value={formatDuration(data.workMs)} unit="นาที" sub={`${session.rounds.length} ยก`} />
        <Stat label="หมัดเข้าลำตัว" value={data.total.body} unit="หมัด" />
      </div>

      <div className="rounded-2xl bg-panel p-3">
        <div className="mb-1 text-sm text-ink-2">สัดส่วนซ้าย / ขวา</div>
        <HandSplit left={data.total.hand.left} right={data.total.hand.right} />
      </div>

      <div className="rounded-2xl bg-panel p-3">
        <div className="mb-2 text-sm text-ink-2">ประเภทหมัด</div>
        <div className="flex flex-col gap-2">
          {PUNCH_TYPES.map((t) => {
            const v = data.total.type[t]
            const pct = data.total.total ? (v / data.total.total) * 100 : 0
            return (
              <div key={t} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 text-sm">
                <span>{PUNCH_LABEL[t]}</span>
                <div className="h-3 rounded-r bg-panel-2">
                  <div className="h-3 rounded-r" style={{ width: `${pct}%`, background: TYPE_COLOR[t] }} />
                </div>
                <span className="tabular text-right">{v}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-panel p-3">
        <div className="mb-2 text-sm text-ink-2">หมัดแต่ละยก</div>
        <div className="h-56">
          <Bar
            data={{
              labels: data.rounds.map((r) => `ยก ${r.index + 1}`),
              datasets: (['left', 'right'] as const).map((h) => ({
                label: h === 'left' ? 'ซ้าย' : 'ขวา',
                data: data.rounds.map((r) => r.tally.hand[h]),
                backgroundColor: HAND_COLOR[h],
                ...barStyle,
              })),
            }}
            options={{ scales: stackedScales, interaction: { mode: 'index', intersect: false } }}
          />
        </div>
        <table className="tabular mt-3 w-full text-sm">
          <thead className="text-ink-3">
            <tr>
              <th className="text-left font-normal">ยก</th>
              <th className="text-right font-normal">ซ้าย</th>
              <th className="text-right font-normal">ขวา</th>
              {PUNCH_TYPES.map((t) => (
                <th key={t} className="text-right font-normal">
                  {t === 'uppercut' ? 'Upper' : t[0].toUpperCase() + t.slice(1)}
                </th>
              ))}
              <th className="text-right font-normal">/นาที</th>
            </tr>
          </thead>
          <tbody>
            {data.rounds.map((r) => (
              <tr key={r.index} className="border-t border-line">
                <td className="py-1">{r.index + 1}</td>
                <td className="text-right">{r.tally.hand.left}</td>
                <td className="text-right">{r.tally.hand.right}</td>
                {PUNCH_TYPES.map((t) => (
                  <td key={t} className="text-right">
                    {r.tally.type[t]}
                  </td>
                ))}
                <td className="text-right">{ppm(r.tally.total, r.durationMs).toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl bg-panel p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <span>จังหวะการชก (ทุก 10 วินาที)</span>
          <div className="ml-auto flex gap-1">
            {data.rounds.map((r, i) => (
              <button
                key={r.index}
                onClick={() => setRoundIdx(i)}
                className={`rounded-full px-3 py-1 text-xs ${i === roundIdx ? 'bg-ink text-black' : 'bg-panel-2'}`}
              >
                ยก {r.index + 1}
              </button>
            ))}
          </div>
        </div>
        <div className="h-48">
          <Line
            data={{
              labels: tl.labels,
              datasets: (['left', 'right'] as const).map((h) => ({
                label: h === 'left' ? 'ซ้าย' : 'ขวา',
                data: h === 'left' ? tl.left : tl.right,
                borderColor: HAND_COLOR[h],
                backgroundColor: HAND_COLOR[h],
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 5,
                tension: 0.3,
              })),
            }}
            options={{
              interaction: { mode: 'index', intersect: false },
              scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
            }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {round.punches.slice(-40).map((p, i) => (
            <span
              key={i}
              title={`${(p.t / 1000).toFixed(1)}s`}
              className="h-2 w-2 rounded-full"
              style={{ background: TYPE_COLOR[punchType(p)] }}
            />
          ))}
        </div>
      </div>

      <button onClick={remove} className="self-start rounded-full bg-panel-2 px-4 py-2 text-sm text-accent">
        ลบเซตนี้
      </button>
    </div>
  )
}

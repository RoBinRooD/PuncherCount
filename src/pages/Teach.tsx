import { useEffect, useMemo, useRef, useState } from 'react'
import type { DetectorConfig } from '../lib/detector'
import type { Settings } from '../lib/settings'
import { deleteClip, listClips, saveClip, updateClip } from '../lib/db'
import { uploadClipVideo, useCloud } from '../lib/cloud'
import CloudBadge from '../components/CloudBadge'
import { extractClipFrames } from '../lib/clipVideo'
import { calibrate, evaluate, extractAll, type Calibration, type ClipLabel, type ClipResult, type TrainingClip } from '../lib/trainer'
import { HAND_LABEL, PUNCH_LABEL, punchType, type Hand, type PunchKind } from '../lib/types'
import { HAND_COLOR } from '../lib/colors'
import { drawSkeleton } from '../components/skeleton'
import { Row, Section, Segmented, Toggle } from '../components/controls'

interface Props {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}

const KINDS: PunchKind[] = ['straight', 'hook', 'uppercut']
const HANDS: Hand[] = ['left', 'right']

function labelText(l: ClipLabel, config: DetectorConfig) {
  const lead = l.hand === (config.stance === 'orthodox' ? 'left' : 'right')
  return `${HAND_LABEL[l.hand]} · ${PUNCH_LABEL[punchType({ kind: l.kind, lead })]}${l.body ? ' · ลำตัว' : ''}`
}

export default function Teach({ settings, update }: Props) {
  const config = settings.detector
  const [clips, setClips] = useState<TrainingClip[] | null>(null)
  const [label, setLabel] = useState<ClipLabel>({ hand: 'left', kind: 'straight', body: false })
  const [count, setCount] = useState('')
  const [busy, setBusy] = useState<{ name: string; progress: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cal, setCal] = useState<Calibration | 'running' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cloud = useCloud()
  const reload = () => listClips().then(setClips)
  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    void reload()
  }, [cloud.revision])

  const results = useMemo(() => (clips ? extractAll(clips, config) : []), [clips, config])
  const evaluation = useMemo(() => (clips && clips.length >= 2 ? evaluate(clips, config) : null), [clips, config])

  const coverage = useMemo(() => {
    const c: Record<Hand, Record<PunchKind, number>> = {
      left: { straight: 0, hook: 0, uppercut: 0 },
      right: { straight: 0, hook: 0, uppercut: 0 },
    }
    for (const r of results) for (const s of r.samples) if (s.kind !== 'none') c[s.hand][s.kind]++
    return c
  }, [results])

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setError(null)
    const expected = Number(count) > 0 ? Math.round(Number(count)) : undefined
    for (const file of Array.from(files)) {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setBusy({ name: file.name, progress: 0 })
      try {
        const { frames, aspect } = await extractClipFrames(
          file,
          (progress, { canvas, pose }) => {
            setBusy({ name: file.name, progress })
            const out = previewRef.current
            if (!out) return
            if (out.width !== canvas.width) {
              out.width = canvas.width
              out.height = canvas.height
            }
            const g = out.getContext('2d')!
            drawSkeleton(g, pose, out.width, out.height, config.swapHands)
            g.globalCompositeOperation = 'destination-over'
            g.drawImage(canvas, 0, 0)
            g.globalCompositeOperation = 'source-over'
          },
          ctrl.signal,
        )
        if (!frames.some((f) => f.p)) throw new Error(`ไม่พบท่าทางคนใน ${file.name}`)
        const clip: TrainingClip = { createdAt: Date.now(), name: file.name, label, expectedCount: expected, aspect, frames }
        const id = await saveClip(clip)
        const d = new Date(clip.createdAt)
        const pad = (n: number) => String(n).padStart(2, '0')
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`
        void uploadClipVideo(id, clip, file, `${labelText(label, config)} ${stamp}`)
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e))
        break
      }
    }
    setBusy(null)
    abortRef.current = null
    setCal(null)
    void reload()
  }

  const remove = async (id: number) => {
    await deleteClip(id)
    setCal(null)
    void reload()
  }

  const edit = async (c: TrainingClip, patch: Pick<TrainingClip, 'label' | 'expectedCount'>) => {
    if (c.id === undefined) return
    await updateClip(c.id, patch)
    setCal(null)
    void reload()
  }

  const runCalibration = async () => {
    if (!clips) return
    setCal('running')
    setCal(await calibrate(clips, config))
  }

  const pct = (n: number, d: number) => `${Math.round((n / d) * 100)}%`

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-3">
      <h1 className="text-xl font-bold">สอนท่าจากคลิป</h1>
      {cloud.connected ? (
        <CloudBadge />
      ) : (
        <p className="text-xs text-ink-3">
          คลิปเก็บไว้ในเครื่องนี้เท่านั้น และไม่เก็บไฟล์วิดีโอ เชื่อม Google Drive ได้ที่แท็บตั้งค่า เพื่อเก็บวิดีโอและใช้ได้หลายเครื่อง
        </p>
      )}

      <Section title="วิธีถ่ายคลิป">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>ตั้งกล้องมุมเดียวกับตอนฝึกจริง (ด้านข้าง เห็นศีรษะถึงสะโพก)</li>
          <li>1 คลิป = หมัดเดียว มือเดียว ชกซ้ำ 8–15 ครั้ง กลับการ์ดให้สุดระหว่างหมัด</li>
          <li>มืออีกข้างให้อยู่ในการ์ดนิ่งๆ (แอปจะใช้เป็นตัวอย่างว่าแบบนี้ "ไม่ใช่หมัด")</li>
          <li>ถ่ายให้ครบทุกท่าที่ใช้ อย่างน้อยท่าละ 2 คลิป และใส่จำนวนหมัดเพื่อใช้ปรับความไว</li>
        </ul>
      </Section>

      <Section title="เพิ่มคลิป">
        <Row label="สไตล์การยืน (ใช้กับทุกคลิปและตอนฝึก)">
          <Segmented
            value={config.stance}
            options={[
              ['orthodox', 'Orthodox (แย็บมือซ้าย)'],
              ['southpaw', 'Southpaw (แย็บมือขวา)'],
            ]}
            onChange={(stance) => update({ detector: { ...config, stance } })}
          />
        </Row>
        <LabelFields label={label} config={config} onChange={setLabel} />
        <label className="flex items-center justify-between gap-2">
          <span className="text-sm text-ink-2">
            จำนวนหมัดในคลิป
            <span className="block text-xs text-ink-3">ไม่บังคับ แต่ช่วยให้แอปตัดหมัดได้แม่นขึ้นและปรับความไวได้</span>
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="—"
            className="tabular w-20 rounded-lg bg-panel-2 py-1.5 text-center"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
        <p className="text-sm">
          ป้าย: <span className="font-semibold">{labelText(label, config)}</span>
        </p>
        <input ref={fileRef} type="file" accept="video/*" multiple className="hidden" onChange={(e) => {
          void onFiles(e.target.files)
          e.target.value = ''
        }} />
        {!busy ? (
          <button onClick={() => fileRef.current?.click()} className="rounded-2xl bg-accent py-3 font-bold text-black">
            เลือกหรือถ่ายคลิป
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <canvas ref={previewRef} className="w-full rounded-xl bg-black" />
            <div className="h-2 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full bg-accent" style={{ width: `${busy.progress * 100}%` }} />
            </div>
            <div className="flex items-center justify-between text-sm text-ink-2">
              <span className="truncate">กำลังวิเคราะห์ {busy.name} · {Math.round(busy.progress * 100)}%</span>
              <button onClick={() => abortRef.current?.abort()} className="rounded-full bg-panel-2 px-3 py-1">
                ยกเลิก
              </button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-accent">{error}</p>}
      </Section>

      {clips && clips.length > 0 && (
        <>
          <Section title="โมเดล">
            <Toggle
              label="ใช้โมเดลจากคลิปตอนนับหมัด"
              hint="ท่าที่ยังไม่ได้สอนจะใช้กฎพื้นฐานแทน"
              checked={settings.useClipModel}
              onChange={(v) => update({ useClipModel: v })}
            />
            <table className="tabular w-full text-center text-sm">
              <thead className="text-xs text-ink-3">
                <tr>
                  <th />
                  {KINDS.map((k) => (
                    <th key={k} className="font-normal">{k === 'straight' ? 'ตรง' : PUNCH_LABEL[k].split(' ')[0]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HANDS.map((h) => (
                  <tr key={h}>
                    <td className="py-1 text-left" style={{ color: HAND_COLOR[h] }}>{HAND_LABEL[h]}</td>
                    {KINDS.map((k) => (
                      <td key={k} className={coverage[h][k] ? '' : 'text-ink-3'}>{coverage[h][k] || '–'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {evaluation && evaluation.total > 0 && (
              <p className="text-sm text-ink-2">
                ทดสอบกับคลิปที่โมเดลไม่เคยเห็น: แยกประเภทถูก{' '}
                <span className="font-semibold text-ink">{pct(evaluation.model, evaluation.total)}</span> (กฎพื้นฐาน{' '}
                {pct(evaluation.heuristic, evaluation.total)}) จาก {evaluation.total} หมัด
              </p>
            )}
          </Section>

          <Section title="ปรับความไวจากคลิป">
            <p className="text-sm text-ink-2">
              หาค่า "ความเร็วขั้นต่ำ" และ "ระยะยื่นขั้นต่ำ" ที่นับได้ตรงกับจำนวนหมัดที่ใส่ไว้ในคลิป
            </p>
            {cal === 'running' ? (
              <p className="text-sm text-ink-2">กำลังคำนวณ…</p>
            ) : cal ? (
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  ความเร็ว {config.minSpeed} → <b>{cal.minSpeed}</b> · ระยะ {config.minDistance} → <b>{cal.minDistance}</b>
                  <br />
                  <span className="text-ink-2">
                    นับคลาดเคลื่อนรวม {cal.errorBefore} → {cal.errorAfter} หมัด จาก {cal.clips} คลิป
                  </span>
                </p>
                <button
                  className="self-start rounded-full bg-ink px-4 py-2 font-semibold text-black"
                  onClick={() => {
                    update({ detector: { ...config, minSpeed: cal.minSpeed, minDistance: cal.minDistance } })
                    setCal(null)
                  }}
                >
                  ใช้ค่านี้
                </button>
              </div>
            ) : (
              <button
                disabled={!clips.some((c) => c.expectedCount)}
                onClick={runCalibration}
                className="self-start rounded-full bg-panel-2 px-4 py-2 text-sm disabled:opacity-40"
              >
                {clips.some((c) => c.expectedCount) ? 'คำนวณ' : 'ต้องมีคลิปที่ใส่จำนวนหมัด'}
              </button>
            )}
          </Section>

          <Section title={`คลิป (${clips.length})`}>
            {clips.map((c, i) => (
              <ClipRow
                key={c.id}
                clip={c}
                result={results[i]}
                config={config}
                onSave={(patch) => edit(c, patch)}
                onRemove={() => c.id !== undefined && remove(c.id)}
                onSwap={() => update({ detector: { ...config, swapHands: !config.swapHands } })}
              />
            ))}
          </Section>
        </>
      )}
    </div>
  )
}

function LabelFields({ label, config, onChange }: { label: ClipLabel; config: DetectorConfig; onChange: (l: ClipLabel) => void }) {
  const lead: Hand = config.stance === 'orthodox' ? 'left' : 'right'
  return (
    <>
      <Row label="ประเภทหมัด">
        <Segmented
          value={label.kind}
          options={KINDS.map((k) => [k, k === 'straight' ? 'หมัดตรง' : PUNCH_LABEL[k].split(' ')[0]] as [PunchKind, string])}
          onChange={(kind) => onChange({ ...label, kind, body: kind === 'uppercut' ? false : label.body })}
        />
      </Row>
      <Row label="มือที่ชก (มือจริงของผู้ชก)">
        <Segmented
          value={label.hand}
          options={HANDS.map((h) => [h, `${HAND_LABEL[h]} (${h === lead ? 'มือหน้า' : 'มือหลัง'})`] as [Hand, string])}
          onChange={(hand) => onChange({ ...label, hand })}
        />
      </Row>
      {label.kind !== 'uppercut' && (
        <Toggle label="หมัดเข้าลำตัว" checked={label.body} onChange={(body) => onChange({ ...label, body })} />
      )}
    </>
  )
}

interface ClipRowProps {
  clip: TrainingClip
  result: ClipResult
  config: DetectorConfig
  onSave: (patch: Pick<TrainingClip, 'label' | 'expectedCount'>) => void
  onRemove: () => void
  onSwap: () => void
}

function ClipRow({ clip, result: r, config, onSave, onRemove, onSwap }: ClipRowProps) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(clip.label)
  const [count, setCount] = useState(clip.expectedCount ? String(clip.expectedCount) : '')
  const n = clip.expectedCount
  const off = n !== undefined && r.found !== n
  // In a one-punch clip the punching arm moves most. If that's the other arm, either the label
  // is wrong or the pose model has the arms swapped (common for the arm away from the camera).
  const mismatch = r.other >= 3 && r.other > r.found
  const otherHand: Hand = clip.label.hand === 'left' ? 'right' : 'left'

  const startEdit = () => {
    setLabel(clip.label)
    setCount(clip.expectedCount ? String(clip.expectedCount) : '')
    setEditing(true)
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2 first:border-0 first:pt-0">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold" style={{ color: HAND_COLOR[clip.label.hand] }}>
            {labelText(clip.label, config)}
          </div>
          <div className="truncate text-xs text-ink-3">{clip.name}</div>
          <div className={`text-xs ${off || r.other > 0 ? 'text-accent' : 'text-ink-2'}`}>
            พบ {r.found}
            {n !== undefined ? `/${n}` : ''} หมัด
            {r.other > 0 ? ` · มืออีกข้างขยับ ${r.other}` : ''}
          </div>
        </div>
        {!editing && (
          <button onClick={startEdit} className="rounded-full bg-panel-2 px-3 py-1 text-xs">
            แก้ไข
          </button>
        )}
        <button onClick={onRemove} className="rounded-full bg-panel-2 px-3 py-1 text-xs">
          ลบ
        </button>
      </div>

      {mismatch && !editing && (
        <div className="flex flex-col gap-2 rounded-xl bg-panel-2 p-3 text-xs text-ink-2">
          <p>
            แขนที่ขยับเป็นหลักในคลิปนี้ถูกตรวจเป็น<b className="text-ink">มือ{HAND_LABEL[otherHand]}</b> ({r.other} ครั้ง)
            ถ้าป้ายถูกแล้ว แปลว่าระบบสลับแขนซ้าย/ขวา (เกิดบ่อยกับแขนข้างที่อยู่ไกลกล้อง)
          </p>
          <button onClick={onSwap} className="self-start rounded-full bg-ink px-3 py-1.5 font-semibold text-black">
            {config.swapHands ? 'ปิด' : 'เปิด'} "สลับซ้าย/ขวา"
          </button>
        </div>
      )}

      {editing && (
        <div className="flex flex-col gap-3 rounded-xl bg-panel-2/50 p-3">
          <LabelFields label={label} config={config} onChange={setLabel} />
          <label className="flex items-center justify-between gap-2">
            <span className="text-sm text-ink-2">จำนวนหมัดในคลิป</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="—"
              className="tabular w-20 rounded-lg bg-panel-2 py-1.5 text-center"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onSave({ label, expectedCount: Number(count) > 0 ? Math.round(Number(count)) : undefined })
                setEditing(false)
              }}
              className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-black"
            >
              บันทึก
            </button>
            <button onClick={() => setEditing(false)} className="rounded-full bg-panel-2 px-4 py-1.5 text-sm">
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

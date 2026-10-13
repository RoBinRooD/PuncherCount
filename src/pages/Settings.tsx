import type { ReactNode } from 'react'
import { DEFAULT_DETECTOR_CONFIG, type DetectorConfig } from '../lib/detector'
import type { Settings } from '../lib/settings'

interface Props {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}

export default function SettingsPage({ settings, update }: Props) {
  const det = (patch: Partial<DetectorConfig>) => update({ detector: { ...settings.detector, ...patch } })
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-3">
      <h1 className="text-xl font-bold">ตั้งค่า</h1>

      <Section title="จับเวลา">
        <NumberRow label="จำนวนยก" value={settings.rounds} min={1} max={30} onChange={(v) => update({ rounds: v })} />
        <NumberRow label="เวลาชกต่อยก (วินาที)" value={settings.workSec} min={10} max={1800} step={10} onChange={(v) => update({ workSec: v })} />
        <NumberRow label="เวลาพัก (วินาที)" value={settings.restSec} min={0} max={600} step={10} onChange={(v) => update({ restSec: v })} />
        <NumberRow label="นับถอยหลังก่อนเริ่ม (วินาที)" value={settings.prepSec} min={0} max={60} onChange={(v) => update({ prepSec: v })} />
      </Section>

      <Section title="ผู้ชกและกล้อง">
        <Row label="สไตล์การยืน">
          <Segmented
            value={settings.detector.stance}
            options={[
              ['orthodox', 'Orthodox (ซ้ายนำ)'],
              ['southpaw', 'Southpaw (ขวานำ)'],
            ]}
            onChange={(v) => det({ stance: v })}
          />
        </Row>
        <Row label="กล้อง">
          <Segmented
            value={settings.camera}
            options={[
              ['environment', 'กล้องหลัง'],
              ['user', 'กล้องหน้า'],
            ]}
            onChange={(v) => update({ camera: v })}
          />
        </Row>
        <Toggle
          label="สลับซ้าย/ขวา"
          hint="เปิดถ้าในโหมดทดสอบ แขนสีฟ้า (ซ้าย) ไปอยู่ที่มือขวาจริงของผู้ชก"
          checked={settings.detector.swapHands}
          onChange={(v) => det({ swapHands: v })}
        />
      </Section>

      <Section title="ความไวการตรวจจับ">
        <Slider
          label="ความเร็วขั้นต่ำ"
          hint="ลดลงถ้านับหมัดไม่ครบ เพิ่มขึ้นถ้านับเกิน"
          value={settings.detector.minSpeed}
          min={1}
          max={5}
          step={0.1}
          onChange={(v) => det({ minSpeed: v })}
        />
        <Slider
          label="ระยะยื่นขั้นต่ำ"
          value={settings.detector.minDistance}
          min={0.15}
          max={0.8}
          step={0.01}
          onChange={(v) => det({ minDistance: v })}
        />
        <Slider
          label="มุมศอกสำหรับฮุก (องศา)"
          hint="หมัดที่ศอกงอน้อยกว่าค่านี้ตอนยื่นสุดจะนับเป็นฮุก"
          value={settings.detector.hookElbowAngle}
          min={90}
          max={160}
          step={1}
          onChange={(v) => det({ hookElbowAngle: v })}
        />
        <Toggle label="แสดงข้อมูลดีบัก" checked={settings.showDebug} onChange={(v) => update({ showDebug: v })} />
        <button
          className="self-start rounded-full bg-panel-2 px-4 py-2 text-sm"
          onClick={() => det({ ...DEFAULT_DETECTOR_CONFIG, stance: settings.detector.stance, swapHands: settings.detector.swapHands })}
        >
          คืนค่าความไวเริ่มต้น
        </button>
      </Section>

      <p className="text-xs text-ink-3">
        ข้อมูลทั้งหมดเก็บในเบราว์เซอร์ของเครื่องนี้เท่านั้น สำรองได้ที่แท็บแดชบอร์ด → ส่งออก JSON
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-panel p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-2">{label}</span>
      {children}
    </div>
  )
}

function NumberRow(p: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  const step = p.step ?? 1
  const set = (v: number) => p.onChange(Math.min(p.max, Math.max(p.min, v)))
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-ink-2">{p.label}</span>
      <div className="flex items-center gap-1">
        <button className="h-9 w-9 rounded-full bg-panel-2" onClick={() => set(p.value - step)}>
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          className="tabular w-16 rounded-lg bg-panel-2 py-1.5 text-center"
          value={p.value}
          onChange={(e) => set(Number(e.target.value) || p.min)}
        />
        <button className="h-9 w-9 rounded-full bg-panel-2" onClick={() => set(p.value + step)}>
          +
        </button>
      </div>
    </div>
  )
}

function Segmented<T extends string>(p: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-full bg-panel-2 p-1 text-sm">
      {p.options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => p.onChange(v)}
          className={`flex-1 rounded-full px-3 py-1.5 ${p.value === v ? 'bg-ink font-semibold text-black' : 'text-ink-2'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Toggle(p: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-ink-2">
        {p.label}
        {p.hint && <span className="block text-xs text-ink-3">{p.hint}</span>}
      </span>
      <input type="checkbox" className="h-5 w-5 accent-accent" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
    </label>
  )
}

function Slider(p: { label: string; hint?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-sm text-ink-2">
        {p.label}
        <span className="tabular text-ink">{p.value}</span>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} className="accent-accent" />
      {p.hint && <span className="text-xs text-ink-3">{p.hint}</span>}
    </label>
  )
}

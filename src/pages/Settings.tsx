import { DEFAULT_DETECTOR_CONFIG, type DetectorConfig } from '../lib/detector'
import type { Settings } from '../lib/settings'
import CloudPanel from '../components/CloudPanel'
import { NumberRow, Row, Section, Segmented, Slider, Toggle } from '../components/controls'

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

      <CloudPanel settings={settings} update={update} />

      <p className="text-xs text-ink-3">
        ถ้าไม่เชื่อม Google Drive ข้อมูลจะอยู่ในเบราว์เซอร์ของเครื่องนี้เท่านั้น สำรองได้ (รวมคลิปสอนท่า) ที่แท็บแดชบอร์ด → ส่งออก JSON
      </p>
    </div>
  )
}

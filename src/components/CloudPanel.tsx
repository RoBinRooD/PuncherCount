import { useState } from 'react'
import { connect, disconnect, useCloud } from '../lib/cloud'
import type { Settings } from '../lib/settings'
import CloudBadge from './CloudBadge'
import { Section } from './controls'

const HELP_URL = 'https://github.com/robinrood/punchercount#google-drive'

export default function CloudPanel({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const cloud = useCloud()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onConnect = async () => {
    setError(null)
    setBusy(true)
    try {
      await connect(settings.googleClientId.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Google Drive">
      <p className="text-sm text-ink-2">
        เก็บประวัติการซ้อม คลิปสอนท่า และวิดีโอต้นฉบับไว้ในโฟลเดอร์ PuncherCount บน Google Drive ของคุณ ใช้ได้หลายเครื่อง
        และข้อมูลไม่หายถ้าล้างเบราว์เซอร์ แอปเข้าถึงได้เฉพาะไฟล์ที่แอปสร้างเอง
      </p>
      {!cloud.connected ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-2">OAuth Client ID</span>
            <input
              className="rounded-lg bg-panel-2 px-3 py-2 text-sm"
              placeholder="xxxxxxxx.apps.googleusercontent.com"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={settings.googleClientId}
              onChange={(e) => update({ googleClientId: e.target.value })}
            />
            <a href={HELP_URL} target="_blank" rel="noreferrer" className="text-xs text-ink-3 underline">
              วิธีสร้าง Client ID (ทำครั้งเดียว ~10 นาที)
            </a>
          </label>
          <button
            disabled={busy || !settings.googleClientId.trim().endsWith('.apps.googleusercontent.com')}
            onClick={onConnect}
            className="self-start rounded-full bg-ink px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {busy ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ Google Drive'}
          </button>
        </>
      ) : (
        <>
          <CloudBadge />
          <button onClick={disconnect} className="self-start rounded-full bg-panel-2 px-4 py-2 text-sm">
            เลิกเชื่อมต่อ
          </button>
          <p className="text-xs text-ink-3">เลิกเชื่อมต่อแล้วข้อมูลในเครื่องและบน Drive ยังอยู่ครบ</p>
        </>
      )}
      {error && <p className="text-sm text-accent">{error}</p>}
    </Section>
  )
}

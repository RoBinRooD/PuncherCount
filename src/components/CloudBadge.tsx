import { useState } from 'react'
import { resume, syncNow, useCloud } from '../lib/cloud'
import { hasToken } from '../lib/drive'
import { loadSettings } from '../lib/settings'

const time = (ts: number) => new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

/** One-line Google Drive status with the action it needs (nothing when sync is off). */
export default function CloudBadge() {
  const cloud = useCloud()
  const [busy, setBusy] = useState(false)
  if (!cloud.connected) return null

  const run = async () => {
    setBusy(true)
    try {
      if (hasToken()) await syncNow()
      else await resume(loadSettings().googleClientId)
    } finally {
      setBusy(false)
    }
  }

  let text: string
  let action: string | null = 'ซิงก์'
  if (cloud.state === 'syncing' || busy) {
    text = 'กำลังซิงก์กับ Google Drive…'
    action = null
  } else if (cloud.state === 'signin') {
    text = 'Google Drive: แตะเพื่อเข้าสู่ระบบและซิงก์'
    action = 'เข้าสู่ระบบ'
  } else if (cloud.state === 'error') {
    text = `ซิงก์ไม่สำเร็จ: ${cloud.message ?? ''}`
    action = 'ลองอีกครั้ง'
  } else {
    text = cloud.lastSync ? `ซิงก์กับ Google Drive แล้ว ${time(cloud.lastSync)}` : 'เชื่อม Google Drive แล้ว'
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-panel px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className={cloud.state === 'error' ? 'text-accent' : 'text-ink-2'}>☁️ {text}</span>
        {action && (
          <button onClick={run} className="shrink-0 rounded-full bg-panel-2 px-3 py-1">
            {action}
          </button>
        )}
      </div>
      {cloud.upload && (
        <div className="flex items-center gap-2 text-ink-3">
          <span className="truncate">อัปโหลดวิดีโอ {cloud.upload.name}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full bg-accent" style={{ width: `${cloud.upload.progress * 100}%` }} />
          </div>
          <span className="tabular">{Math.round(cloud.upload.progress * 100)}%</span>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { PunchDetector, type DetectorDebug, type Landmark } from '../lib/detector'
import { BODY_EDGES, LEFT_ARM, RIGHT_ARM, loadPoseLandmarker } from '../lib/pose'
import type { Settings } from '../lib/settings'
import { sounds, unlockAudio, vibrate } from '../lib/audio'
import { saveSession } from '../lib/db'
import { addToTally, emptyTally, formatDuration, type Tally } from '../lib/stats'
import { HAND_LABEL, PUNCH_LABEL, PUNCH_TYPES, punchType, type PunchEvent, type RoundRecord } from '../lib/types'
import { HAND_COLOR, TYPE_COLOR } from '../lib/colors'

type Phase = 'idle' | 'prep' | 'work' | 'rest'

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'พร้อม',
  prep: 'เตรียมตัว',
  work: 'ชก!',
  rest: 'พัก',
}

export default function Train({ settings }: { settings: Settings }) {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const detectorRef = useRef(new PunchDetector(settings.detector))
  const streamRef = useRef<MediaStream | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  const [camera, setCamera] = useState<'off' | 'loading' | 'on'>('off')
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [paused, setPaused] = useState(false)
  const [round, setRound] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [roundTally, setRoundTally] = useState<Tally>(emptyTally)
  const [sessionTally, setSessionTally] = useState<Tally>(emptyTally)
  const [flash, setFlash] = useState<PunchEvent | null>(null)
  const [debug, setDebug] = useState<DetectorDebug | null>(null)
  const [fps, setFps] = useState(0)

  // Mutable timer/session state read inside the rAF loop and the timer interval.
  const s = useRef({
    phase: 'idle' as Phase,
    paused: false,
    round: 0,
    phaseEndAt: 0,
    pausedRemaining: 0,
    lastWarnSec: -1,
    punches: [] as PunchEvent[],
    rounds: [] as RoundRecord[],
    startedAt: 0,
  })

  useEffect(() => {
    detectorRef.current.config = { ...settings.detector }
  }, [settings.detector])

  // ---------- camera + detection loop ----------

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamera('off')
  }, [])

  const startCamera = useCallback(async () => {
    setError(null)
    setCamera('loading')
    try {
      const [stream, landmarker] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: settings.camera, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        }),
        loadPoseLandmarker(),
      ])
      streamRef.current = stream
      landmarkerRef.current = landmarker
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      detectorRef.current.reset()
      setCamera('on')
    } catch (e) {
      console.error(e)
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์'
          : `เปิดกล้องหรือโหลดโมเดลไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`,
      )
      stopCamera()
    }
  }, [settings.camera, stopCamera])

  useEffect(() => () => stopCamera(), [stopCamera])

  const onPunch = useCallback((p: PunchEvent, frameT: number) => {
    const st = s.current
    setFlash(p)
    if (st.phase !== 'work' || st.paused) return // calibration: show but don't record
    const roundMs = settings.workSec * 1000
    const ev = { ...p, t: Math.max(0, roundMs - (st.phaseEndAt - frameT)) }
    st.punches.push(ev)
    setRoundTally((t) => addToTally({ ...t, hand: { ...t.hand }, type: { ...t.type } }, ev))
    setSessionTally((t) => addToTally({ ...t, hand: { ...t.hand }, type: { ...t.type } }, ev))
  }, [settings.workSec])

  useEffect(() => {
    if (camera !== 'on') return
    let raf = 0
    let lastVideoTime = -1
    let frames = 0
    let fpsAt = performance.now()
    const video = videoRef.current!
    const canvas = canvasRef.current!
    const g = canvas.getContext('2d')!

    const loop = () => {
      raf = requestAnimationFrame(loop)
      const lm = landmarkerRef.current
      if (!lm || video.readyState < 2 || video.currentTime === lastVideoTime) return
      lastVideoTime = video.currentTime
      const now = performance.now()
      const res = lm.detectForVideo(video, now)
      const pose = res.landmarks[0] as Landmark[] | undefined
      const aspect = video.videoWidth / video.videoHeight
      for (const p of detectorRef.current.update(pose, now, aspect)) onPunch(p, now)

      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      drawSkeleton(g, pose, canvas.width, canvas.height, settings.detector.swapHands)

      frames++
      if (now - fpsAt > 1000) {
        setFps(Math.round((frames * 1000) / (now - fpsAt)))
        setDebug(detectorRef.current.debug())
        frames = 0
        fpsAt = now
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [camera, onPunch, settings.detector.swapHands])

  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), 600)
    return () => clearTimeout(id)
  }, [flash])

  // ---------- round timer ----------

  const enterPhase = useCallback((next: Phase, seconds: number) => {
    const st = s.current
    st.phase = next
    st.phaseEndAt = performance.now() + seconds * 1000
    st.lastWarnSec = -1
    setPhase(next)
    setRemaining(seconds * 1000)
  }, [])

  const finish = useCallback(async () => {
    const st = s.current
    st.phase = 'idle'
    setPhase('idle')
    setPaused(false)
    st.paused = false
    void wakeLockRef.current?.release()
    wakeLockRef.current = null
    const rounds = st.rounds.filter((r) => r.durationMs > 0)
    if (rounds.length === 0) return
    const id = await saveSession({
      startedAt: st.startedAt,
      endedAt: Date.now(),
      stance: settings.detector.stance,
      plan: { rounds: settings.rounds, workSec: settings.workSec, restSec: settings.restSec },
      rounds,
    })
    navigate(`/session/${id}`)
  }, [navigate, settings])

  const closeRound = useCallback((durationMs: number) => {
    const st = s.current
    st.rounds.push({ index: st.round, durationMs, punches: st.punches })
    st.punches = []
  }, [])

  const startWork = useCallback((roundIdx: number) => {
    s.current.round = roundIdx
    setRound(roundIdx)
    setRoundTally(emptyTally())
    sounds.roundStart()
    vibrate(300)
    enterPhase('work', settings.workSec)
  }, [enterPhase, settings.workSec])

  useEffect(() => {
    if (phase === 'idle') return
    const id = setInterval(() => {
      const st = s.current
      if (st.paused) return
      const left = st.phaseEndAt - performance.now()
      setRemaining(Math.max(0, left))
      const sec = Math.ceil(left / 1000)
      if (sec !== st.lastWarnSec) {
        st.lastWarnSec = sec
        if (st.phase === 'work' && sec === 10) sounds.warning()
        if (st.phase !== 'work' && sec <= 3 && sec > 0) sounds.tick()
      }
      if (left > 0) return
      if (st.phase === 'prep') startWork(0)
      else if (st.phase === 'work') {
        closeRound(settings.workSec * 1000)
        sounds.roundEnd()
        vibrate([200, 100, 200])
        if (st.round + 1 >= settings.rounds) void finish()
        else enterPhase('rest', settings.restSec)
      } else if (st.phase === 'rest') startWork(st.round + 1)
    }, 100)
    return () => clearInterval(id)
  }, [phase, settings, startWork, closeRound, enterPhase, finish])

  const start = async () => {
    unlockAudio()
    if (camera === 'off') void startCamera()
    try {
      wakeLockRef.current = await navigator.wakeLock?.request('screen')
    } catch {
      // wake lock unsupported or denied
    }
    const st = s.current
    st.rounds = []
    st.punches = []
    st.startedAt = Date.now()
    setSessionTally(emptyTally())
    setRoundTally(emptyTally())
    setRound(0)
    st.round = 0
    if (settings.prepSec > 0) enterPhase('prep', settings.prepSec)
    else startWork(0)
  }

  const togglePause = () => {
    const st = s.current
    if (!st.paused) {
      st.pausedRemaining = st.phaseEndAt - performance.now()
    } else {
      st.phaseEndAt = performance.now() + st.pausedRemaining
    }
    st.paused = !st.paused
    setPaused(st.paused)
  }

  const stop = () => {
    const st = s.current
    if (st.phase === 'work') {
      const left = st.paused ? st.pausedRemaining : st.phaseEndAt - performance.now()
      closeRound(Math.max(0, settings.workSec * 1000 - left))
    }
    void finish()
  }

  const running = phase !== 'idle'
  const mirror = settings.camera === 'user'

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black">
        <div className="absolute inset-0" style={{ transform: mirror ? 'scaleX(-1)' : undefined }}>
          <video ref={videoRef} playsInline muted className="h-full w-full object-contain" />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />
        </div>

        {camera !== 'on' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {camera === 'loading' ? (
              <p className="text-ink-2">กำลังเปิดกล้องและโหลดโมเดล…</p>
            ) : (
              <>
                <p className="text-sm text-ink-2">
                  วางมือถือด้านข้างกระสอบ ให้เห็นผู้ชกด้านข้างทั้งตัวตั้งแต่ศีรษะถึงสะโพก
                </p>
                <button onClick={startCamera} className="rounded-full bg-panel-2 px-5 py-2 font-semibold">
                  เปิดกล้อง / ทดสอบท่า
                </button>
              </>
            )}
            {error && <p className="text-sm text-accent">{error}</p>}
          </div>
        )}

        {/* timer overlay */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <div className="rounded-xl bg-black/60 px-3 py-1.5">
            <div className="text-xs text-ink-2">
              {PHASE_LABEL[phase]}
              {running && ` · ยก ${round + 1}/${settings.rounds}`}
              {paused && ' · หยุดชั่วคราว'}
            </div>
            <div className="tabular text-3xl font-extrabold">
              {running ? formatDuration(remaining) : formatDuration(settings.workSec * 1000)}
            </div>
          </div>
          {camera === 'on' && <div className="rounded-lg bg-black/60 px-2 py-1 text-xs text-ink-3">{fps} fps</div>}
        </div>

        {flash && (
          <div
            className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1.5 text-lg font-bold text-white"
            style={{ background: HAND_COLOR[flash.hand] }}
          >
            {HAND_LABEL[flash.hand]} · {PUNCH_LABEL[punchType(flash)]}
            {flash.body ? ' · ลำตัว' : ''}
          </div>
        )}
      </div>

      {/* live counters */}
      <div className="grid grid-cols-3 gap-2">
        <Counter label="หมัดซ้าย" value={roundTally.hand.left} color={HAND_COLOR.left} />
        <Counter label="รวมยกนี้" value={roundTally.total} />
        <Counter label="หมัดขวา" value={roundTally.hand.right} color={HAND_COLOR.right} />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {PUNCH_TYPES.map((t) => (
          <div key={t} className="rounded-xl bg-panel p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-[11px] text-ink-2">
              <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />
              {PUNCH_LABEL[t].split(' ')[0]}
            </div>
            <div className="tabular text-xl font-bold">{roundTally.type[t]}</div>
          </div>
        ))}
      </div>
      {running && (
        <p className="text-center text-sm text-ink-2">
          ทั้งเซต: <span className="tabular font-semibold text-ink">{sessionTally.total}</span> หมัด
        </p>
      )}

      <div className="flex gap-2">
        {!running ? (
          <button onClick={start} className="flex-1 rounded-2xl bg-accent py-4 text-lg font-bold text-black">
            เริ่ม {settings.rounds} ยก × {formatDuration(settings.workSec * 1000)}
          </button>
        ) : (
          <>
            <button onClick={togglePause} className="flex-1 rounded-2xl bg-panel-2 py-4 text-lg font-bold">
              {paused ? 'ต่อ' : 'หยุดชั่วคราว'}
            </button>
            <button onClick={stop} className="flex-1 rounded-2xl bg-accent py-4 text-lg font-bold text-black">
              จบและบันทึก
            </button>
          </>
        )}
      </div>

      {settings.showDebug && debug && (
        <pre className="overflow-x-auto rounded-xl bg-panel p-3 text-xs text-ink-2">
          {`หันหน้า: ${debug.facing > 0 ? 'ขวา →' : '← ซ้าย'}  scale: ${debug.scale.toFixed(3)}
ซ้าย  เห็น:${debug.left.visible ? 'Y' : 'N'} speed:${debug.left.speed.toFixed(2)} ศอก:${debug.left.elbow.toFixed(0)}° ${debug.left.moving ? '▶' : ''}
ขวา   เห็น:${debug.right.visible ? 'Y' : 'N'} speed:${debug.right.speed.toFixed(2)} ศอก:${debug.right.elbow.toFixed(0)}° ${debug.right.moving ? '▶' : ''}`}
        </pre>
      )}
    </div>
  )
}

function Counter({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-2xl bg-panel p-3 text-center">
      <div className="flex items-center justify-center gap-1.5 text-xs text-ink-2">
        {color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
        {label}
      </div>
      <div className="tabular text-4xl font-extrabold">{value}</div>
    </div>
  )
}

function drawSkeleton(g: CanvasRenderingContext2D, pose: Landmark[] | undefined, w: number, h: number, swap: boolean) {
  g.clearRect(0, 0, w, h)
  if (!pose) return
  const line = (edges: [number, number][], color: string, width: number) => {
    g.strokeStyle = color
    g.lineWidth = width
    g.lineCap = 'round'
    for (const [a, b] of edges) {
      const pa = pose[a]
      const pb = pose[b]
      if ((pa.visibility ?? 1) < 0.2 || (pb.visibility ?? 1) < 0.2) continue
      g.beginPath()
      g.moveTo(pa.x * w, pa.y * h)
      g.lineTo(pb.x * w, pb.y * h)
      g.stroke()
    }
  }
  const lw = Math.max(3, w / 160)
  line(BODY_EDGES, 'rgba(240,239,236,0.6)', lw)
  line(LEFT_ARM, swap ? HAND_COLOR.right : HAND_COLOR.left, lw * 1.6)
  line(RIGHT_ARM, swap ? HAND_COLOR.left : HAND_COLOR.right, lw * 1.6)
  for (const i of [15, 16]) {
    const p = pose[i]
    if ((p.visibility ?? 1) < 0.2) continue
    const isLeft = (i === 15) !== swap
    g.fillStyle = isLeft ? HAND_COLOR.left : HAND_COLOR.right
    g.beginPath()
    g.arc(p.x * w, p.y * h, lw * 3, 0, Math.PI * 2)
    g.fill()
  }
}

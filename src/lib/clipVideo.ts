import type { Landmark } from './detector'
import { loadPoseLandmarker, poseTimestamp } from './pose'
import { encodeLandmarks, type ClipFrame } from './trainer'

const FPS = 30
const MAX_WIDTH = 640
const MAX_SECONDS = 120

export interface ExtractedClip {
  frames: ClipFrame[]
  aspect: number
}

function once(el: HTMLMediaElement, event: string) {
  return new Promise<void>((resolve, reject) => {
    const ok = () => {
      el.removeEventListener('error', fail)
      resolve()
    }
    const fail = () => {
      el.removeEventListener(event, ok)
      reject(new Error('อ่านไฟล์วิดีโอไม่ได้ (ลองไฟล์ MP4 หรือ MOV)'))
    }
    el.addEventListener(event, ok, { once: true })
    el.addEventListener('error', fail, { once: true })
  })
}

/**
 * Run pose detection over a video file frame by frame (seeking at a fixed 30 fps so the
 * result doesn't depend on how fast this phone is). Optionally draws each frame to `preview`.
 */
export async function extractClipFrames(
  file: File,
  onProgress: (fraction: number, frame: { canvas: HTMLCanvasElement; pose: Landmark[] | undefined }) => void,
  signal?: AbortSignal,
): Promise<ExtractedClip> {
  const landmarker = await loadPoseLandmarker()
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  // Some mobile browsers only decode frames for videos that are in the document.
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none'
  document.body.appendChild(video)
  try {
    video.src = url
    await once(video, 'loadeddata')
    let duration = video.duration
    if (!Number.isFinite(duration)) {
      // Recordings without a duration header: seeking far ahead makes the browser compute it.
      video.currentTime = 1e9
      await once(video, 'seeked')
      duration = video.duration
    }
    duration = Math.min(duration, MAX_SECONDS)
    if (!video.videoWidth || !Number.isFinite(duration)) throw new Error('อ่านไฟล์วิดีโอไม่ได้')

    const scale = Math.min(1, MAX_WIDTH / video.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const g = canvas.getContext('2d', { willReadFrequently: false })!

    const frames: ClipFrame[] = []
    const n = Math.floor(duration * FPS)
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw new DOMException('ยกเลิกแล้ว', 'AbortError')
      video.currentTime = i / FPS
      await once(video, 'seeked')
      g.drawImage(video, 0, 0, canvas.width, canvas.height)
      const res = landmarker.detectForVideo(canvas, poseTimestamp(performance.now()))
      const pose = res.landmarks[0] as Landmark[] | undefined
      frames.push({ t: (i * 1000) / FPS, p: encodeLandmarks(pose) })
      onProgress((i + 1) / n, { canvas, pose })
    }
    return { frames, aspect: video.videoWidth / video.videoHeight }
  } finally {
    video.remove()
    URL.revokeObjectURL(url)
  }
}

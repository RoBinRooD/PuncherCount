import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

// WASM runtime and model are copied into public/mediapipe at build time
// (scripts/prepare-mediapipe.mjs) and cached by the service worker after first use.
const assetBase = new URL(`${import.meta.env.BASE_URL}mediapipe/`, document.baseURI).href
export const WASM_URL = assetBase.slice(0, -1)
export const MODEL_URL = `${assetBase}pose_landmarker_lite.task`

let pending: Promise<PoseLandmarker> | null = null

export function loadPoseLandmarker(): Promise<PoseLandmarker> {
  pending ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
    const opts = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
    try {
      return await opts('GPU')
    } catch {
      return await opts('CPU')
    }
  })()
  pending.catch(() => (pending = null))
  return pending
}

let lastTs = 0

/**
 * VIDEO mode requires strictly increasing timestamps per landmarker, and the camera loop and
 * clip processing share one instance - route every detectForVideo timestamp through here.
 */
export function poseTimestamp(t: number): number {
  lastTs = Math.max(t, lastTs + 1)
  return lastTs
}

/** Skeleton edges to draw (arms highlighted separately). */
export const BODY_EDGES: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
]
export const LEFT_ARM: [number, number][] = [[11, 13], [13, 15]]
export const RIGHT_ARM: [number, number][] = [[12, 14], [14, 16]]

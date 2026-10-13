// Copies the MediaPipe WASM runtime out of node_modules and downloads the pose model
// into public/mediapipe/ so the app serves everything from its own origin (GitHub Pages).
import fs from 'node:fs'
import path from 'node:path'

const out = path.resolve('public/mediapipe')
const wasmDir = path.resolve('node_modules/@mediapipe/tasks-vision/wasm')
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

fs.mkdirSync(out, { recursive: true })
for (const f of fs.readdirSync(wasmDir)) {
  if (f.includes('module')) continue // ESM variant is unused
  fs.copyFileSync(path.join(wasmDir, f), path.join(out, f))
}

const modelPath = path.join(out, 'pose_landmarker_lite.task')
if (!fs.existsSync(modelPath)) {
  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`model download failed: ${res.status}`)
  fs.writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()))
}
console.log('mediapipe assets ready in public/mediapipe')

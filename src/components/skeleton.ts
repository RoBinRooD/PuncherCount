import type { Landmark } from '../lib/detector'
import { BODY_EDGES, LEFT_ARM, RIGHT_ARM } from '../lib/pose'
import { HAND_COLOR } from '../lib/colors'

export function drawSkeleton(g: CanvasRenderingContext2D, pose: Landmark[] | undefined, w: number, h: number, swap: boolean) {
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

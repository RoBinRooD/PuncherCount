import { describe, expect, it } from 'vitest'
import { PunchDetector } from './detector'
import { GUARD, frame, punchFrames, type Pose } from './testPoses'

function run(poses: Pose[], det = new PunchDetector()) {
  const idle: Pose = { left: GUARD, right: GUARD }
  const all = [...Array(10).fill(idle), ...poses, ...Array(10).fill(idle)]
  const events = []
  for (let i = 0; i < all.length; i++) events.push(...det.update(frame(all[i]), i * (1000 / 30)))
  return events
}

describe('PunchDetector', () => {
  it('ignores a still guard', () => {
    expect(run([])).toHaveLength(0)
  })

  it('counts a lead straight as a jab', () => {
    const ev = run(punchFrames('left', { x: 1.1, y: 0.05 }))
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ hand: 'left', kind: 'straight', lead: true })
  })

  it('counts a rear straight as a cross', () => {
    const ev = run(punchFrames('right', { x: 1.1, y: 0.05 }))
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ hand: 'right', kind: 'straight', lead: false })
  })

  it('classifies an upward movement as an uppercut', () => {
    const ev = run(punchFrames('right', { x: 0.35, y: -0.55 }))
    expect(ev).toHaveLength(1)
    expect(ev[0].kind).toBe('uppercut')
  })

  it('classifies a forward punch with a bent elbow as a hook', () => {
    const ev = run(punchFrames('left', { x: 0.75, y: 0.0, elbowBent: true }))
    expect(ev).toHaveLength(1)
    expect(ev[0].kind).toBe('hook')
  })

  it('counts a 1-2 combination separately per hand', () => {
    const ev = run([
      ...punchFrames('left', { x: 1.1, y: 0.05 }),
      ...punchFrames('right', { x: 1.1, y: 0.05 }),
    ])
    expect(ev.map((e) => e.hand)).toEqual(['left', 'right'])
  })

  it('respects stance and swapHands', () => {
    const det = new PunchDetector({ stance: 'southpaw', swapHands: true })
    const ev = run(punchFrames('left', { x: 1.1, y: 0.05 }), det)
    expect(ev[0]).toMatchObject({ hand: 'right', lead: true })
  })

  it('ignores slow movements', () => {
    const ev = run(punchFrames('left', { x: 1.1, y: 0.05 }, 3000))
    expect(ev).toHaveLength(0)
  })
})

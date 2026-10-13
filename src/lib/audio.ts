let ctx: AudioContext | null = null

/** Must be called from a user gesture (iOS won't play audio otherwise). */
export function unlockAudio() {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
}

export function beep(freq = 880, ms = 150, times = 1) {
  if (!ctx) return
  for (let i = 0; i < times; i++) {
    const start = ctx.currentTime + i * (ms / 1000) * 1.6
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.3, start)
    gain.gain.exponentialRampToValueAtTime(0.001, start + ms / 1000)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + ms / 1000)
  }
}

export const sounds = {
  roundStart: () => beep(1000, 400),
  roundEnd: () => beep(600, 250, 3),
  warning: () => beep(1200, 80, 2),
  tick: () => beep(700, 60),
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // not supported
  }
}

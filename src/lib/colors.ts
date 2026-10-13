import type { Hand, PunchType } from './types'

// Dark-mode categorical steps from the validated reference palette.
export const HAND_COLOR: Record<Hand, string> = { left: '#3987e5', right: '#d95926' }
export const TYPE_COLOR: Record<PunchType, string> = {
  jab: '#3987e5',
  cross: '#d95926',
  hook: '#199e70',
  uppercut: '#c98500',
}
export const INK = { primary: '#f0efec', secondary: '#c3c2b7', muted: '#8d8c84', grid: '#2c2c29', surface: '#1a1a19' }

import { useCallback, useState } from 'react'
import { DEFAULT_DETECTOR_CONFIG, type DetectorConfig } from './detector'

export interface Settings {
  rounds: number
  workSec: number
  restSec: number
  prepSec: number
  camera: 'environment' | 'user'
  showDebug: boolean
  detector: DetectorConfig
}

export const DEFAULT_SETTINGS: Settings = {
  rounds: 3,
  workSec: 180,
  restSec: 60,
  prepSec: 10,
  camera: 'environment',
  showDebug: false,
  detector: DEFAULT_DETECTOR_CONFIG,
}

const KEY = 'puncher-count:settings'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    const s = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...s, detector: { ...DEFAULT_DETECTOR_CONFIG, ...s.detector } }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function useSettings() {
  const [settings, setState] = useState(loadSettings)
  const update = useCallback((patch: Partial<Settings>) => {
    setState((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // storage unavailable (private mode) - keep in memory only
      }
      return next
    })
  }, [])
  return [settings, update] as const
}

// SoundNest — sound catalog, presets and pure mixer logic.
// Audio is either bundled (synthesized, CC0 — see scripts/generate-sounds.mjs)
// or imported by the user (stored locally in IndexedDB).

import rain from '../assets/sounds/rain.wav'
import ocean from '../assets/sounds/ocean.wav'
import wind from '../assets/sounds/wind.wav'
import stream from '../assets/sounds/stream.wav'
import fireplace from '../assets/sounds/fireplace.wav'
import storm from '../assets/sounds/storm.wav'
import crickets from '../assets/sounds/crickets.wav'
import cafe from '../assets/sounds/cafe.wav'

export interface SoundDef {
  id: string
  name: string
  src: string
  kind: 'builtin' | 'imported'
  license?: string
}

export const BUILTIN_SOUNDS: SoundDef[] = [
  { id: 'rain', name: 'Rain', src: rain, kind: 'builtin', license: 'CC0 (synthesized, this project)' },
  { id: 'ocean', name: 'Ocean Waves', src: ocean, kind: 'builtin', license: 'CC0 (synthesized, this project)' },
  { id: 'wind', name: 'Wind', src: wind, kind: 'builtin', license: 'CC0 (synthesized, this project)' },
  { id: 'stream', name: 'Forest Stream', src: stream, kind: 'builtin', license: 'CC0 (synthesized, this project)' },
  { id: 'fireplace', name: 'Fireplace', src: fireplace, kind: 'builtin', license: 'CC0 (synthesized, this project)' },
  { id: 'storm', name: 'Thunderstorm', src: storm, kind: 'builtin', license: 'CC0 (synthesized, this project)' },
  { id: 'crickets', name: 'Crickets', src: crickets, kind: 'builtin', license: 'CC0 (synthesized, this project)' },
  { id: 'cafe', name: 'Café Murmur', src: cafe, kind: 'builtin', license: 'CC0 (synthesized, this project)' },
]

export interface Preset {
  id: string
  name: string
  levels: Record<string, number> // soundId -> 0..100
}

export const PRESETS: Preset[] = [
  { id: 'focus', name: 'Deep Focus', levels: { rain: 45, cafe: 30 } },
  { id: 'cozy', name: 'Rainy Cozy', levels: { fireplace: 60, rain: 55 } },
  { id: 'sleep', name: 'Storm Sleep', levels: { storm: 55, wind: 20 } },
  { id: 'nature', name: 'Nature Walk', levels: { stream: 65, wind: 30 } },
  { id: 'night', name: 'Night Crickets', levels: { crickets: 45, wind: 15 } },
]

export interface Profile extends Preset {
  builtin: boolean
}

/** Effective per-sound volume: per-sound 0..100 × master 0..100 → 0..1 (inputs clamped). */
export function effectiveVolume(level: number, master: number): number {
  const l = Math.max(0, Math.min(100, level))
  const m = Math.max(0, Math.min(100, master))
  return (l / 100) * (m / 100)
}

/** Sort with favorites first, then catalog order; keep stable for the rest. */
export function sortFavoritesFirst<T extends { id: string }>(items: T[], favorites: Set<string>): T[] {
  return [...items].sort((a, b) => {
    const fa = favorites.has(a.id) ? 0 : 1
    const fb = favorites.has(b.id) ? 0 : 1
    return fa - fb
  })
}

/** Parse a sleep-timer value into minutes (0 = off / invalid). */
export function parseSleepTimer(value: string): number {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0) return 0
  if (n > 12 * 60) return 12 * 60 // hard cap 12 h
  return n
}

/** Format seconds as mm:ss (or h:mm:ss). */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`
}

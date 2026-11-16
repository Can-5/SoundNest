import { describe, it, expect } from 'vitest'
import { effectiveVolume, sortFavoritesFirst, parseSleepTimer, formatCountdown, PRESETS } from './library'

describe('effectiveVolume', () => {
  it('multiplies sound by master and clamps 0..1', () => {
    expect(effectiveVolume(100, 100)).toBe(1)
    expect(effectiveVolume(50, 50)).toBeCloseTo(0.25)
    expect(effectiveVolume(0, 100)).toBe(0)
    expect(effectiveVolume(120, 50)).toBe(0.5)
  })
})

describe('sortFavoritesFirst', () => {
  it('favorites come first, order otherwise stable', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    expect(sortFavoritesFirst(items, new Set(['c'])).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('parseSleepTimer', () => {
  it('parses minutes, 0 for off/invalid, caps at 12h', () => {
    expect(parseSleepTimer('25')).toBe(25)
    expect(parseSleepTimer('0')).toBe(0)
    expect(parseSleepTimer('abc')).toBe(0)
    expect(parseSleepTimer('99999')).toBe(720)
  })
})

describe('formatCountdown', () => {
  it('formats mm:ss and clamps negatives', () => {
    expect(formatCountdown(65)).toBe('1:05')
    expect(formatCountdown(600)).toBe('10:00')
    expect(formatCountdown(3661)).toBe('1:01:01')
    expect(formatCountdown(-5)).toBe('0:00')
  })
})

describe('presets', () => {
  it('every preset level references a builtin sound with 0..100', () => {
    for (const p of PRESETS) {
      for (const [id, level] of Object.entries(p.levels)) {
        expect(id).toMatch(/^[a-z]+$/)
        expect(level).toBeGreaterThanOrEqual(0)
        expect(level).toBeLessThanOrEqual(100)
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import type { PrayerStatus } from '@shared/types'
import {
  daylightAt,
  sunPhaseAt,
  sunTimesFromPrayers,
  themePosition,
  type SunTimes
} from '@shared/daylight'

const H = 3_600_000
const base = Date.UTC(2026, 8, 2, 0, 0, 0)
const at = (hours: number): number => base + hours * H

const sun: SunTimes = {
  dawn: at(5),
  sunrise: at(6.5),
  sunset: at(19),
  night: at(20.5)
}

/** Only the four fields the reader looks at need to be real. */
const prayer = (name: PrayerStatus['prayer'], start: number, end: number): PrayerStatus => ({
  prayer: name,
  state: 'upcoming',
  start,
  end,
  doneAt: null,
  msLeft: 0,
  canMakeUp: false
})

const dayPrayers = (): PrayerStatus[] => [
  prayer('fajr', sun.dawn, sun.sunrise),
  prayer('dhuhr', at(12), at(15.5)),
  prayer('asr', at(15.5), sun.sunset),
  prayer('maghrib', sun.sunset, sun.night),
  prayer('isha', sun.night, at(29))
]

describe('daylightAt', () => {
  it('is full night before dawn and after the last light', () => {
    expect(daylightAt(at(2), sun)).toBe(0)
    expect(daylightAt(at(5), sun)).toBe(0)
    expect(daylightAt(at(20.5), sun)).toBe(0)
    expect(daylightAt(at(23), sun)).toBe(0)
  })

  it('is full daylight between sunrise and sunset', () => {
    expect(daylightAt(at(6.5), sun)).toBe(1)
    expect(daylightAt(at(13), sun)).toBe(1)
    expect(daylightAt(at(19), sun)).toBe(1)
  })

  it('rises through dawn and falls through dusk', () => {
    const earlyDawn = daylightAt(at(5.3), sun)
    const lateDawn = daylightAt(at(6.2), sun)
    expect(earlyDawn).toBeGreaterThan(0)
    expect(earlyDawn).toBeLessThan(lateDawn)
    expect(lateDawn).toBeLessThan(1)

    const earlyDusk = daylightAt(at(19.3), sun)
    const lateDusk = daylightAt(at(20.2), sun)
    expect(earlyDusk).toBeGreaterThan(lateDusk)
    expect(lateDusk).toBeGreaterThan(0)
  })

  it('sits at half way through the middle of each transition', () => {
    expect(daylightAt(at(5.75), sun)).toBeCloseTo(0.5, 5)
    expect(daylightAt(at(19.75), sun)).toBeCloseTo(0.5, 5)
  })

  it('never leaves the 0..1 range', () => {
    for (let h = 0; h <= 24; h += 0.25) {
      const v = daylightAt(at(h), sun)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('sunPhaseAt', () => {
  it('names each stretch of the day', () => {
    expect(sunPhaseAt(at(3), sun)).toBe('night')
    expect(sunPhaseAt(at(5.5), sun)).toBe('dawn')
    expect(sunPhaseAt(at(13), sun)).toBe('day')
    expect(sunPhaseAt(at(20), sun)).toBe('dusk')
    expect(sunPhaseAt(at(22), sun)).toBe('night')
  })
})

describe('sunTimesFromPrayers', () => {
  it('reads the four moments off the day', () => {
    expect(sunTimesFromPrayers(dayPrayers())).toEqual(sun)
  })

  it('refuses a day whose moments are out of order', () => {
    // A polar day can collapse the windows onto each other; better to fall back
    // to a fixed theme than to blend across a nonsense range.
    const broken = dayPrayers().map((p) =>
      p.prayer === 'maghrib' ? { ...p, start: at(4) } : p
    )
    expect(sunTimesFromPrayers(broken)).toBeNull()
  })

  it('refuses a day that is missing a prayer', () => {
    expect(sunTimesFromPrayers(dayPrayers().filter((p) => p.prayer !== 'isha'))).toBeNull()
  })
})

describe('themePosition', () => {
  it('is deep night and full day at the extremes, with no lean either way', () => {
    expect(themePosition(0)).toEqual({ polarity: 0, warm: 0 })
    expect(themePosition(1)).toEqual({ polarity: 1, warm: 0 })
  })

  it('inverts once, at the middle of the transition', () => {
    expect(themePosition(0.49).polarity).toBe(0)
    expect(themePosition(0.5).polarity).toBe(1)
  })

  it('leans hardest at the crossing, from both sides', () => {
    expect(themePosition(0.49).warm).toBeCloseTo(0.98, 5)
    expect(themePosition(0.5).warm).toBeCloseTo(1, 5)
    expect(themePosition(0.51).warm).toBeCloseTo(0.98, 5)
  })

  it('leans further as the light changes, on either side of the flip', () => {
    expect(themePosition(0.1).warm).toBeLessThan(themePosition(0.3).warm)
    expect(themePosition(0.9).warm).toBeLessThan(themePosition(0.7).warm)
  })

  it('keeps warm inside 0..1 for any input, including nonsense', () => {
    for (const d of [-5, -0.1, 0, 0.25, 0.5, 0.75, 1, 1.1, 42]) {
      const { warm, polarity } = themePosition(d)
      expect(warm).toBeGreaterThanOrEqual(0)
      expect(warm).toBeLessThanOrEqual(1)
      expect([0, 1]).toContain(polarity)
    }
  })
})

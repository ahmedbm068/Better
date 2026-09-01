/** Typed settings store. Every value is a JSON blob in the `settings` table. */
import type { Settings } from '@shared/types'
import { CALC_METHODS, MADHABS } from '@shared/types'
import { getDb } from './handle'
import { systemZone } from '@shared/time'

export const DEFAULT_SETTINGS: Settings = {
  latitude: 36.8065,
  longitude: 10.1815,
  timezone: 'Africa/Tunis',
  calcMethod: 'MuslimWorldLeague',
  madhab: 'shafi',
  dayStartOffsetMin: 0,
  trackingStartDate: null,
  theme: 'dark',
  notifyOnWindowOpen: true,
  notifyLeadMinutes: [30, 10],
  targetBedtime: '23:30',
  targetWakeTime: '06:30',
  sleepTargetToleranceMin: 30,
  quitDate: null,
  cigarettesPerDay: 20,
  pricePerPack: 9.5,
  cigarettesPerPack: 20,
  currency: 'TND',
  launchOnStartup: false,
  minimizeToTray: true,
  longSessionWarnHours: 4
}

export function readSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{
    key: string
    value: string
  }>
  const stored: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value)
    } catch {
      // A corrupt value falls back to its default rather than breaking startup.
    }
  }
  return sanitize({ ...DEFAULT_SETTINGS, ...stored })
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const merged = sanitize({ ...readSettings(), ...patch })
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const write = getDb().transaction(() => {
    for (const [key, value] of Object.entries(merged)) stmt.run(key, JSON.stringify(value))
  })
  write()
  return merged
}

const clamp = (n: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback

const isHHMM = (s: unknown): s is string => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s)

const isDateStr = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Keeps out-of-range or malformed values from ever reaching prayer maths. */
function sanitize(s: Settings): Settings {
  const timezone = isValidZone(s.timezone) ? s.timezone : systemZone()
  return {
    ...s,
    latitude: clamp(Number(s.latitude), -90, 90, DEFAULT_SETTINGS.latitude),
    longitude: clamp(Number(s.longitude), -180, 180, DEFAULT_SETTINGS.longitude),
    timezone,
    calcMethod: CALC_METHODS.includes(s.calcMethod) ? s.calcMethod : DEFAULT_SETTINGS.calcMethod,
    madhab: MADHABS.includes(s.madhab) ? s.madhab : DEFAULT_SETTINGS.madhab,
    dayStartOffsetMin: clamp(Number(s.dayStartOffsetMin), -180, 180, 0),
    trackingStartDate: isDateStr(s.trackingStartDate) ? s.trackingStartDate : null,
    theme: s.theme === 'light' ? 'light' : 'dark',
    notifyOnWindowOpen: Boolean(s.notifyOnWindowOpen),
    notifyLeadMinutes: Array.isArray(s.notifyLeadMinutes)
      ? [...new Set(s.notifyLeadMinutes.map(Number).filter((n) => n > 0 && n <= 720))].sort(
          (a, b) => b - a
        )
      : DEFAULT_SETTINGS.notifyLeadMinutes,
    targetBedtime: isHHMM(s.targetBedtime) ? s.targetBedtime : DEFAULT_SETTINGS.targetBedtime,
    targetWakeTime: isHHMM(s.targetWakeTime) ? s.targetWakeTime : DEFAULT_SETTINGS.targetWakeTime,
    sleepTargetToleranceMin: clamp(Number(s.sleepTargetToleranceMin), 0, 240, 30),
    quitDate: isDateStr(s.quitDate) ? s.quitDate : null,
    cigarettesPerDay: clamp(Number(s.cigarettesPerDay), 0, 200, 20),
    pricePerPack: clamp(Number(s.pricePerPack), 0, 10000, 9.5),
    cigarettesPerPack: clamp(Number(s.cigarettesPerPack), 1, 200, 20),
    currency: typeof s.currency === 'string' && s.currency.length <= 8 ? s.currency : 'TND',
    launchOnStartup: Boolean(s.launchOnStartup),
    minimizeToTray: Boolean(s.minimizeToTray),
    longSessionWarnHours: clamp(Number(s.longSessionWarnHours), 1, 24, 4)
  }
}

function isValidZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

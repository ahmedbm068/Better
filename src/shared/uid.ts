/**
 * UUIDv7 — the identity a row carries between devices.
 *
 * Local integer ids stay the primary key and every foreign key keeps using
 * them, so nothing above the repositories changes. This is the identity that
 * crosses the wire instead, because two devices creating a habit while offline
 * would otherwise both call it id 7.
 *
 * Version 7 is time-ordered on purpose: ids sort by creation, so a pull applies
 * rows in the order they were actually made.
 *
 * Layout (RFC 9562): 48 bits of Unix milliseconds, 4 version bits, 12 random,
 * 2 variant bits, 62 random.
 */
import type { Millis } from './types'

/**
 * Cryptographic randomness where it exists, which is everywhere this runs.
 *
 * Typed structurally rather than as the DOM's `Crypto`: this module is compiled
 * by both the main-process and renderer configs, and only one of them has lib.dom.
 */
type RandomSource = { getRandomValues?: (array: Uint8Array) => Uint8Array }

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  const c = (globalThis as { crypto?: RandomSource }).crypto
  if (typeof c?.getRandomValues === 'function') return c.getRandomValues(out)
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256)
  return out
}

const hex2 = (b: number): string => b.toString(16).padStart(2, '0')

export function uuidv7(now: Millis = Date.now()): string {
  // Clamp rather than throw: a wrong clock must never block a write.
  const ms = Math.min(Math.max(0, Math.floor(now)), 0xffffffffffff)
  const time = ms.toString(16).padStart(12, '0')

  const bytes = randomBytes(10)
  bytes[0] = (bytes[0] & 0x0f) | 0x70 // version 7
  bytes[2] = (bytes[2] & 0x3f) | 0x80 // variant 10
  const tail = Array.from(bytes, hex2).join('')

  return `${time.slice(0, 8)}-${time.slice(8, 12)}-${tail.slice(0, 4)}-${tail.slice(4, 8)}-${tail.slice(8, 20)}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Guards the sync boundary: anything arriving from off-device is checked. */
export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** The creation instant encoded in a v7 id, for ordering without a lookup. */
export function uuidV7Time(uid: string): Millis {
  return parseInt(uid.slice(0, 8) + uid.slice(9, 13), 16)
}

import { describe, it, expect } from 'vitest'
import { uuidv7, isUuidV7, uuidV7Time } from '@shared/uid'

describe('uuidv7', () => {
  it('has the v7 shape', () => {
    expect(isUuidV7(uuidv7())).toBe(true)
  })

  it('encodes the creation time in the prefix', () => {
    const at = Date.UTC(2026, 8, 1, 12, 30, 0)
    expect(uuidV7Time(uuidv7(at))).toBe(at)
  })

  it('sorts lexicographically by creation time', () => {
    const early = uuidv7(1_600_000_000_000)
    const late = uuidv7(1_700_000_000_000)
    expect([late, early].sort()).toEqual([early, late])
  })

  it('does not collide inside a single millisecond', () => {
    const at = Date.now()
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7(at)))
    expect(ids.size).toBe(10_000)
  })

  it('survives a clock at or before the epoch', () => {
    expect(isUuidV7(uuidv7(0))).toBe(true)
    expect(isUuidV7(uuidv7(-1))).toBe(true)
  })

  it('rejects anything that is not a v7 id', () => {
    expect(isUuidV7('')).toBe(false)
    expect(isUuidV7(7)).toBe(false)
    // A valid v4 id: right shape, wrong version — must not pass.
    expect(isUuidV7('9f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f')).toBe(false)
  })
})

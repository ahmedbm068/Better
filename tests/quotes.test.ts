import { describe, expect, it } from 'vitest'
import { MAX_LENGTH, QUOTES, STRIDE, quoteForDate } from '@shared/quotes'

/**
 * Words that must never appear in a quote.
 *
 * The user asked for lines that carry nothing a Muslim would have to reject, so
 * the whole vocabulary of other-power — fate, luck, the universe as a giver —
 * is out, along with anything that names divinity at all. Matched on word
 * boundaries, because "good" contains "god" and "muscle" contains "us".
 */
const FORBIDDEN = [
  // Other-power, the kufr line.
  'universe',
  'fate',
  'destiny',
  'destined',
  'karma',
  'manifest',
  'manifesting',
  'luck',
  'lucky',
  'fortune',
  'cosmos',
  'cosmic',
  'zodiac',
  'horoscope',
  'stars',
  // Naming divinity at all.
  'god',
  'gods',
  'goddess',
  'lord',
  'divine',
  'heaven',
  'holy',
  'sacred',
  'worship',
  'pray',
  'prayer',
  'blessed',
  'miracle',
  // Haram in passing.
  'wine',
  'beer',
  'drunk',
  'alcohol',
  'gamble',
  'bet',
  'lottery'
]

describe('the quote list', () => {
  it('never uses a forbidden word', () => {
    const offenders: string[] = []
    for (const quote of QUOTES) {
      for (const word of FORBIDDEN) {
        if (new RegExp(`\\b${word}\\b`, 'i').test(quote)) {
          offenders.push(`"${quote}" contains "${word}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('stays inside two lines', () => {
    const tooLong = QUOTES.filter((q) => q.length > MAX_LENGTH)
    expect(tooLong).toEqual([])
  })

  it('has no duplicates', () => {
    expect(new Set(QUOTES).size).toBe(QUOTES.length)
  })

  it('is never empty and never shouts', () => {
    for (const quote of QUOTES) {
      expect(quote.trim()).toBe(quote)
      expect(quote.length).toBeGreaterThan(0)
      expect(quote).not.toBe(quote.toUpperCase())
    }
  })
})

describe('quoteForDate', () => {
  it('gives the same line for the same day, every time', () => {
    expect(quoteForDate('2026-09-02')).toBe(quoteForDate('2026-09-02'))
  })

  it('changes from one day to the next', () => {
    expect(quoteForDate('2026-09-02')).not.toBe(quoteForDate('2026-09-03'))
  })

  it('uses a stride that is coprime with the list, so nothing repeats early', () => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
    expect(gcd(STRIDE, QUOTES.length)).toBe(1)
  })

  it('shows every quote once before repeating any', () => {
    const start = Date.UTC(2026, 0, 1)
    const seen = new Set<string>()
    for (let i = 0; i < QUOTES.length; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
      seen.add(quoteForDate(date))
    }
    expect(seen.size).toBe(QUOTES.length)
  })

  it('always returns a real quote, across several years of dates', () => {
    const start = Date.UTC(2024, 0, 1)
    for (let i = 0; i < 1200; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
      expect(QUOTES).toContain(quoteForDate(date))
    }
  })
})

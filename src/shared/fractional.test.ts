import { describe, expect, it } from 'vitest'
import { keyBetween, keysBetween } from './fractional'

describe('keyBetween', () => {
  it('returns a key between its bounds', () => {
    const cases: Array<[string | null, string | null]> = [
      [null, null],
      ['n', null],
      [null, 'n'],
      ['n', 'p'],
      ['n', 'o'],
      ['an', 'ao'],
    ]
    for (const [a, b] of cases) {
      const key = keyBetween(a, b)
      if (a !== null) expect(key > a, `${key} > ${a}`).toBe(true)
      if (b !== null) expect(key < b, `${key} < ${b}`).toBe(true)
    }
  })

  it('never returns a key ending in the zero digit', () => {
    // A key ending in 'a' would leave no room below it, so the next insert
    // before it could not be expressed at all.
    let key = keyBetween(null, null)
    for (let i = 0; i < 200; i++) {
      expect(key.endsWith('a')).toBe(false)
      key = keyBetween(null, key)
    }
  })

  it('keeps splitting the same gap indefinitely', () => {
    const lower = keyBetween(null, null)
    let upper = keyBetween(lower, null)
    for (let i = 0; i < 100; i++) {
      const mid = keyBetween(lower, upper)
      expect(mid > lower && mid < upper).toBe(true)
      upper = mid
    }
  })

  it('rejects bounds that are not in order', () => {
    expect(() => keyBetween('p', 'n')).toThrow()
    expect(() => keyBetween('n', 'n')).toThrow()
  })
})

describe('keysBetween', () => {
  it('returns ascending keys inside the bounds', () => {
    const keys = keysBetween('n', 'p', 5)
    expect(keys).toHaveLength(5)
    expect([...keys].sort()).toEqual(keys)
    for (const key of keys) expect(key > 'n' && key < 'p').toBe(true)
  })

  it('returns nothing for a count of zero', () => {
    expect(keysBetween(null, null, 0)).toEqual([])
  })
})

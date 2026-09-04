import { describe, expect, it } from 'vitest'
import { reduceMenu } from './menu'

describe('reduceMenu', () => {
  it.each([
    ['ArrowDown', 0, { kind: 'focus', index: 1 }],
    ['ArrowDown', 2, { kind: 'focus', index: 0 }],
    ['ArrowUp', 0, { kind: 'focus', index: 2 }],
    ['Home', 2, { kind: 'focus', index: 0 }],
    ['End', 0, { kind: 'focus', index: 2 }],
  ] as const)('%s from %i wraps around three items', (key, from, expected) => {
    expect(reduceMenu(3, from, key)).toEqual(expected)
  })

  it('closes on Escape', () => {
    expect(reduceMenu(3, 1, 'Escape')).toEqual({ kind: 'close' })
  })

  it.each([['Enter'], [' ']] as const)(
    'picks the focused item on %s',
    (key) => {
      expect(reduceMenu(3, 1, key)).toEqual({ kind: 'activate', index: 1 })
    },
  )

  it('has nothing to move through in an empty menu', () => {
    expect(reduceMenu(0, 0, 'ArrowDown')).toBeNull()
    expect(reduceMenu(0, 0, 'Enter')).toEqual({ kind: 'close' })
  })
})

import { describe, expect, it } from 'vitest'
import { moveFocus } from './treegrid'
import type { TreeItem } from './treegrid'

const item = (
  id: string,
  level: number,
  extra: Partial<TreeItem> = {},
): TreeItem => ({
  id,
  level,
  expandable: level === 1,
  expanded: false,
  ...extra,
})

// A device with two windows open, followed by a second, collapsed device.
const items: TreeItem[] = [
  item('a', 1, { expandable: true, expanded: true }),
  item('a1', 2),
  item('a2', 2),
  item('b', 1, { expandable: true, expanded: false }),
]

describe('moveFocus', () => {
  it.each([
    ['ArrowDown', 0, { kind: 'focus', index: 1 }],
    ['ArrowUp', 2, { kind: 'focus', index: 1 }],
    ['Home', 2, { kind: 'focus', index: 0 }],
    ['End', 0, { kind: 'focus', index: 3 }],
  ] as const)('%s from %i', (key, from, expected) => {
    expect(moveFocus(items, from, key)).toEqual(expected)
  })

  it('stays put at the ends rather than wrapping', () => {
    expect(moveFocus(items, 0, 'ArrowUp')).toBeNull()
    expect(moveFocus(items, 3, 'ArrowDown')).toBeNull()
    expect(moveFocus(items, 0, 'Home')).toBeNull()
    expect(moveFocus(items, 3, 'End')).toBeNull()
  })

  it('opens a closed node, then steps into it', () => {
    expect(moveFocus(items, 3, 'ArrowRight')).toEqual({
      kind: 'expand',
      id: 'b',
    })
    expect(moveFocus(items, 0, 'ArrowRight')).toEqual({
      kind: 'focus',
      index: 1,
    })
  })

  it('does nothing to the right of a leaf', () => {
    expect(moveFocus(items, 1, 'ArrowRight')).toBeNull()
  })

  it('closes an open node, and climbs from a child', () => {
    expect(moveFocus(items, 0, 'ArrowLeft')).toEqual({
      kind: 'collapse',
      id: 'a',
    })
    expect(moveFocus(items, 2, 'ArrowLeft')).toEqual({
      kind: 'focus',
      index: 0,
    })
  })

  it('has nowhere to climb from a closed root', () => {
    expect(moveFocus(items, 3, 'ArrowLeft')).toBeNull()
  })

  it('recovers when the tree shrank under a stale index', () => {
    expect(moveFocus(items, 99, 'ArrowDown')).toEqual({
      kind: 'focus',
      index: 0,
    })
    expect(moveFocus([], 0, 'ArrowDown')).toBeNull()
  })
})

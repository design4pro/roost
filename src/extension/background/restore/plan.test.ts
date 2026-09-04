import { describe, expect, it } from 'vitest'
import type { TabData, TabGroupData, WindowData } from '#/shared/protocol/ops'
import { BATCH_SIZE, planRestore } from './plan'

const LAZY = 'chrome-extension://abc/lazy.html'

const tab = (index: number, extra: Partial<TabData> = {}): TabData => ({
  deviceId: 'other',
  windowId: 'w1',
  groupId: null,
  url: `https://example.com/${index}`,
  title: `Page ${index}`,
  favIconUrl: null,
  pinned: false,
  discarded: false,
  active: false,
  lastAccessed: 0,
  ...extra,
})

const window = (extra: Partial<WindowData> = {}): WindowData => ({
  deviceId: 'other',
  state: 'normal',
  bounds: { left: 10, top: 20, width: 800, height: 600 },
  focused: false,
  tabOrder: [],
  ...extra,
})

const group = (extra: Partial<TabGroupData> = {}): TabGroupData => ({
  deviceId: 'other',
  windowId: 'w1',
  title: 'Research',
  color: 'blue',
  collapsed: false,
  ...extra,
})

describe('planRestore', () => {
  it('loads the first tab for real and leaves the rest as placeholders', () => {
    const plan = planRestore(window(), [tab(0), tab(1)], {}, LAZY)

    expect(plan?.window.url).toBe('https://example.com/0')
    expect(plan?.batches[0]?.[0]?.url).toContain(
      `${LAZY}?u=https%3A%2F%2Fexample.com%2F1`,
    )
  })

  it('splits the rest into batches Chrome can keep up with', () => {
    const tabs = Array.from({ length: 25 }, (_unused, i) => tab(i))
    const plan = planRestore(window(), tabs, {}, LAZY)

    expect(plan?.batches.map((batch) => batch.length)).toEqual([
      BATCH_SIZE,
      BATCH_SIZE,
      4,
    ])
  })

  it('keeps pinning as a separate step for the first tab', () => {
    const plan = planRestore(
      window(),
      [tab(0, { pinned: true }), tab(1, { pinned: true })],
      {},
      LAZY,
    )

    expect(plan?.firstPinned).toBe(true)
    expect(plan?.batches[0]?.[0]?.pinned).toBe(true)
  })

  it.each([
    ['maximized', null],
    ['fullscreen', null],
    ['minimized', null],
  ] as const)('sends no bounds with a %s window', (state, bounds) => {
    const plan = planRestore(window({ state }), [tab(0)], {}, LAZY)
    expect(plan?.window).toMatchObject({ state, bounds })
  })

  it('keeps the bounds of an ordinary window', () => {
    const plan = planRestore(window(), [tab(0)], {}, LAZY)
    expect(plan?.window.bounds).toEqual({
      left: 10,
      top: 20,
      width: 800,
      height: 600,
    })
  })

  it('groups tabs by their position in the restored window', () => {
    const tabs = [
      tab(0),
      tab(1, { groupId: 'g1' }),
      tab(2, { groupId: 'g1' }),
      tab(3, { groupId: 'gone' }),
    ]
    const plan = planRestore(window(), tabs, { g1: group() }, LAZY)

    expect(plan?.groups).toEqual([
      { title: 'Research', color: 'blue', collapsed: false, offsets: [1, 2] },
    ])
  })

  it('has nothing to do for a window with no tabs', () => {
    expect(planRestore(window(), [], {}, LAZY)).toBeNull()
  })
})

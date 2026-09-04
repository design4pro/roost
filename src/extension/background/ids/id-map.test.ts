import { describe, expect, it } from 'vitest'
import type { Store } from '../deps'
import { createIdMap } from './id-map'

const memoryStore = (): Store => {
  const data = new Map<string, unknown>()
  return {
    get: <T>(key: string) => Promise.resolve(data.get(key) as T | undefined),
    set: (key, value) => {
      data.set(key, value)
      return Promise.resolve()
    },
    remove: (key) => {
      data.delete(key)
      return Promise.resolve()
    },
  }
}

const counter = () => {
  let n = 0
  return () => `id-${++n}`
}

describe('the id map', () => {
  it('gives one thing one id', async () => {
    const map = createIdMap(memoryStore(), counter())
    expect(await map.uuidFor('tab', 7)).toBe('id-1')
    expect(await map.uuidFor('tab', 7)).toBe('id-1')
    expect(await map.uuidFor('window', 7)).toBe('id-2')
  })

  it('answers in both directions', async () => {
    const map = createIdMap(memoryStore(), counter())
    const id = await map.uuidFor('tab', 7)
    expect(await map.chromeIdFor('tab', id)).toBe(7)
    expect(await map.peek('tab', 8)).toBeUndefined()
  })

  it('survives the service worker being restarted', async () => {
    const store = memoryStore()
    const id = await createIdMap(store, counter()).uuidFor('tab', 7)
    expect(await createIdMap(store, counter()).uuidFor('tab', 7)).toBe(id)
  })

  it('keeps the id when Chrome replaces a tab', async () => {
    // Memory Saver discards a tab and gives it back under a new number. Losing
    // the id here would show up as the tab closing and a different one opening.
    const map = createIdMap(memoryStore(), counter())
    const id = await map.uuidFor('tab', 7)
    await map.remap('tab', 7, 9)

    expect(await map.uuidFor('tab', 9)).toBe(id)
    expect(await map.peek('tab', 7)).toBeUndefined()
  })

  it('ignores a remap of something it never saw', async () => {
    const map = createIdMap(memoryStore(), counter())
    await map.remap('tab', 7, 9)
    expect(await map.peek('tab', 9)).toBeUndefined()
  })

  it('forgets a tab that is gone', async () => {
    const map = createIdMap(memoryStore(), counter())
    await map.uuidFor('tab', 7)
    await map.forget('tab', 7)
    expect(await map.uuidFor('tab', 7)).toBe('id-2')
  })
})

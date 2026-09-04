import { describe, expect, it } from 'vitest'
import { createAppliedRing, remember, RING_SIZE } from './applied-ring'
import type { Store } from '../deps'

const memoryStore = (): Store => {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string) => Promise.resolve(values.get(key) as T | undefined),
    set: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
    remove: (key) => {
      values.delete(key)
      return Promise.resolve()
    },
  }
}

describe('remember', () => {
  it('keeps the newest ids and forgets the oldest', () => {
    const full = Array.from({ length: RING_SIZE }, (_unused, i) => `c${i}`)
    const next = remember(full, 'new')

    expect(next).toHaveLength(RING_SIZE)
    expect(next.at(-1)).toBe('new')
    expect(next).not.toContain('c0')
  })

  it('moves an id it already holds rather than storing it twice', () => {
    expect(remember(['a', 'b'], 'a')).toEqual(['b', 'a'])
  })
})

describe('createAppliedRing', () => {
  it('recognises a command it has already carried out', async () => {
    const ring = createAppliedRing(memoryStore())

    await expect(ring.seen('c1')).resolves.toBe(false)
    await ring.record('c1')
    await expect(ring.seen('c1')).resolves.toBe(true)
  })
})

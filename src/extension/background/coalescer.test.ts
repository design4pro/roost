import { describe, expect, it } from 'vitest'
import { emptyCoalescer, mark, tick } from './coalescer'

const marks = (entries: Array<[string, number]>) =>
  entries.reduce((state, [key, at]) => mark(state, key, at), emptyCoalescer())

describe('the coalescer', () => {
  it('asks to be called again while a key is still settling', () => {
    const [, result] = tick(marks([['tab:1', 0]]), 100)
    expect(result.flush).toBeUndefined()
    expect(result.nextDeadline).toBe(300)
  })

  it('holds a key that keeps changing', () => {
    // Five updates on one tab within the quiet period read the browser once,
    // not five times, and cost one row instead of five.
    const state = marks([
      ['tab:1', 0],
      ['tab:1', 100],
      ['tab:1', 200],
    ])
    expect(tick(state, 250)[1].flush).toBeUndefined()
    expect(tick(state, 500)[1].flush).toEqual(['tab:1'])
  })

  it('stops waiting once the oldest key has waited long enough', () => {
    const state = marks([
      ['tab:1', 0],
      ['tab:1', 250],
      ['tab:1', 490],
    ])
    // The quiet period has not elapsed, but a drag can keep it from ever
    // elapsing, and the user is owed an update before the drag ends.
    expect(tick(state, 500)[1].flush).toEqual(['tab:1'])
  })

  it('flushes every key together, oldest first', () => {
    const state = marks([
      ['tab:2', 10],
      ['window:1', 0],
      ['tab:1', 5],
    ])
    expect(tick(state, 400)[1].flush).toEqual(['window:1', 'tab:1', 'tab:2'])
  })

  it('gives up waiting when too many keys pile up', () => {
    const state = marks(
      Array.from(
        { length: 100 },
        (_, i) => [`tab:${i}`, 0] as [string, number],
      ),
    )
    expect(tick(state, 1)[1].flush).toHaveLength(100)
  })

  it('empties itself on flush', () => {
    const [next, result] = tick(marks([['tab:1', 0]]), 400)
    expect(result.flush).toEqual(['tab:1'])
    expect(tick(next, 1000)).toEqual([next, {}])
  })
})

import { describe, expect, it } from 'vitest'
import type { Op } from '#/shared/protocol/ops'
import { ack, compact, emptyQueue, enqueue, needsCompaction } from './queue'

const tab = (id: string): Op => ({
  op: 'upsert',
  entity: 'tab',
  id,
  data: {
    deviceId: 'device-a',
    windowId: 'w1',
    groupId: null,
    url: `https://example.test/${id}`,
    title: id,
    favIconUrl: null,
    pinned: false,
    discarded: false,
    active: false,
    lastAccessed: 1,
  },
})

const closeWindow: Op = { op: 'delete', entity: 'window', id: 'w9' }

const command: Op = {
  op: 'command',
  id: 'c1',
  target: 'device-b',
  body: { kind: 'tab.close', tabId: 't1' },
}

describe('the outbound queue', () => {
  it('numbers each batch so the hub can refuse a repeat', () => {
    const queue = enqueue(enqueue(emptyQueue(), [tab('t1')], 0), [tab('t2')], 1)
    expect(queue.batches.map((b) => b.clientSeq)).toEqual([1, 2])
  })

  it('splits a flush too large for one frame', () => {
    const ops = Array.from({ length: 250 }, (_, i) => tab(`t${i}`))
    const queue = enqueue(emptyQueue(), ops, 0)

    expect(queue.batches.map((b) => b.ops.length)).toEqual([100, 100, 50])
  })

  it('ignores an empty flush', () => {
    expect(enqueue(emptyQueue(), [], 0)).toEqual(emptyQueue())
  })

  it('forgets what the hub has acknowledged, and only that', () => {
    const queue = enqueue(emptyQueue(), [tab('t1')], 0)
    const more = enqueue(queue, [tab('t2')], 0)

    expect(ack(more, 1).batches.map((b) => b.clientSeq)).toEqual([2])
    expect(ack(more, 0)).toBe(more)
  })

  it('never reuses a number after compaction', () => {
    const queue = enqueue(emptyQueue(), [tab('t1'), tab('t2')], 0)
    expect(compact(queue, [tab('t1')]).batches[0]?.clientSeq).toBe(2)
  })

  it('keeps what a snapshot cannot express', () => {
    // A closed window is simply absent from a snapshot, and a command is an
    // instruction to another device rather than a fact about this one - both
    // would be lost silently if compaction dropped everything.
    const queue = enqueue(emptyQueue(), [tab('t1'), closeWindow, command], 0)
    const ops = compact(queue, [tab('t2')]).batches.flatMap((b) => b.ops)

    expect(ops).toEqual([closeWindow, command, tab('t2')])
  })

  it('compacts only once the backlog is genuinely long', () => {
    const short = Array.from({ length: 200 }, (_, i) => tab(`t${i}`)).reduce(
      (queue, op) => enqueue(queue, [op], 0),
      emptyQueue(),
    )
    expect(needsCompaction(short)).toBe(false)
    expect(needsCompaction(enqueue(short, [tab('extra')], 0))).toBe(true)
  })
})

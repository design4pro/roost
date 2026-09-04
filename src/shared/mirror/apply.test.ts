import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '../protocol/fixtures'
import { applyOps } from './apply'
import { emptyMirror } from './types'

describe('applyOps', () => {
  it.each(SCENARIOS)('$name', ({ ops, expected }) => {
    expect(applyOps(emptyMirror(), ops)).toEqual(expected)
  })

  it('leaves its input alone', () => {
    const before = emptyMirror()
    applyOps(before, [
      {
        op: 'upsert',
        entity: 'device',
        id: 'd1',
        data: {
          name: 'Chrome',
          os: 'macOS',
          browserVersion: '141',
          extensionVersion: '0.1.0',
          online: true,
          lastSeen: 1,
        },
      },
    ])
    expect(before).toEqual(emptyMirror())
  })

  it('is the same applied in one pass or op by op', () => {
    // The socket delivers changes in whatever chunks the server chose, so a
    // client that reconnects mid-stream must land on the same mirror as one
    // that got everything at once.
    for (const { ops, expected } of SCENARIOS) {
      const stepwise = ops.reduce(
        (mirror, op) => applyOps(mirror, [op]),
        emptyMirror(),
      )
      expect(stepwise).toEqual(expected)
    }
  })
})

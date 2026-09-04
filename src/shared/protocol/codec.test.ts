import { describe, expect, it } from 'vitest'
import { SCENARIOS } from './fixtures'
import { decodeClientFrame, decodeServerFrame, encode } from './codec'
import { PROTOCOL_VERSION } from './ops'

const hello = {
  type: 'hello' as const,
  protocol: PROTOCOL_VERSION,
  deviceId: 'd1',
  name: 'Chrome on macOS',
  os: 'macOS',
  browserVersion: '141',
  extensionVersion: '0.1.0',
  lastSeq: 0,
  lastClientSeq: 0,
}

describe('codec', () => {
  it('round-trips every op in the fixtures', () => {
    for (const scenario of SCENARIOS) {
      const frame = {
        type: 'changes' as const,
        seqFrom: 1,
        seqTo: 2,
        ops: scenario.ops,
      }
      const decoded = decodeServerFrame(encode(frame))
      expect(decoded.ok, scenario.name).toBe(true)
      if (decoded.ok) expect(decoded.frame).toEqual(frame)
    }
  })

  it('round-trips hello', () => {
    const decoded = decodeClientFrame(encode(hello))
    expect(decoded).toEqual({ ok: true, frame: hello })
  })

  it.each([
    ['not text', 42],
    ['not JSON', '{'],
    ['not a known frame', JSON.stringify({ type: 'nonsense' })],
    [
      'a hello with no device',
      JSON.stringify({ ...hello, deviceId: undefined }),
    ],
  ])('rejects %s', (_name, raw) => {
    expect(decodeClientFrame(raw).ok).toBe(false)
  })

  it('rejects an ops frame over the batch limit', () => {
    const op = { op: 'delete' as const, entity: 'tab' as const, id: 't1' }
    const frame = {
      type: 'ops' as const,
      clientSeq: 1,
      ops: Array(101).fill(op),
    }
    expect(decodeClientFrame(encode(frame)).ok).toBe(false)
  })

  it('rejects a frame over the size limit', () => {
    const huge = JSON.stringify({ type: 'hello', pad: 'x'.repeat(1024 * 1024) })
    expect(decodeClientFrame(huge)).toEqual({
      ok: false,
      reason: 'frame exceeds the size limit',
    })
  })

  it('keeps unknown fields, so an older peer survives a newer one', () => {
    // Every frame schema is loose on purpose: a field added in a later protocol
    // version must not turn a working socket into a 4002.
    const decoded = decodeClientFrame(
      JSON.stringify({ ...hello, somethingNew: true }),
    )
    expect(decoded.ok && 'somethingNew' in decoded.frame).toBe(true)
  })
})

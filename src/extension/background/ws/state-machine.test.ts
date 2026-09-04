import { describe, expect, it } from 'vitest'
import type { Hello } from '#/shared/protocol/messages'
import {
  CLOSE_BAD_FRAME,
  CLOSE_PROTOCOL_VERSION,
  CLOSE_QUOTA,
} from '#/shared/protocol/messages'
import { PROTOCOL_VERSION } from '#/shared/protocol/ops'
import type { WsEvent, WsState } from './state-machine'
import { initialState, reduce } from './state-machine'

const HELLO: Hello = {
  type: 'hello',
  protocol: PROTOCOL_VERSION,
  deviceId: '11111111-1111-4111-8111-111111111111',
  name: 'Chrome on macOS',
  os: 'macOS',
  browserVersion: '140',
  extensionVersion: '0.1.0',
  lastSeq: 0,
  lastClientSeq: 0,
}

const context = { now: 1000, random: () => 0.5 }

/** Run a sequence of events, returning the final state and the last effects. */
const run = (events: WsEvent[], from: WsState = initialState()) =>
  events.reduce<{
    state: WsState
    effects: ReturnType<typeof reduce>['effects']
  }>((acc, event) => reduce(acc.state, event, context), {
    state: from,
    effects: [],
  })

const connected = () =>
  run([
    { type: 'start', hello: HELLO },
    { type: 'socket_open' },
    { type: 'frame', frame: { type: 'welcome', seq: 5, mode: 'delta' } },
  ])

describe('the connection', () => {
  it('opens a socket and introduces itself', () => {
    const start = reduce(
      initialState(),
      { type: 'start', hello: HELLO },
      context,
    )
    expect(start.state.kind).toBe('connecting')
    expect(start.effects).toEqual([{ type: 'open_socket' }])

    const opened = reduce(start.state, { type: 'socket_open' }, context)
    expect(opened.state.kind).toBe('handshaking')
    expect(opened.effects).toEqual([{ type: 'send_hello', hello: HELLO }])
  })

  it('sends what was waiting once the hub has answered', () => {
    const result = connected()
    expect(result.state.kind).toBe('open')
    expect(result.effects).toEqual([{ type: 'flush_queue' }])
  })

  it('ignores a second start while it is already connecting', () => {
    // The watchdog alarm fires every half minute whatever else is going on.
    const start = reduce(
      initialState(),
      { type: 'start', hello: HELLO },
      context,
    )
    const again = reduce(start.state, { type: 'start', hello: HELLO }, context)
    expect(again.effects).toEqual([])
    expect(again.state).toBe(start.state)
  })

  it('hands incoming frames to the rest of the extension', () => {
    const open = connected().state
    expect(
      reduce(
        open,
        {
          type: 'frame',
          frame: { type: 'changes', seqFrom: 1, seqTo: 2, ops: [] },
        },
        context,
      ).effects,
    ).toEqual([{ type: 'apply', ops: [], seqTo: 2 }])

    expect(
      reduce(
        open,
        { type: 'frame', frame: { type: 'ack', clientSeq: 3, seq: 9 } },
        context,
      ).effects,
    ).toEqual([{ type: 'acked', clientSeq: 3, seq: 9 }])

    expect(
      reduce(
        open,
        { type: 'frame', frame: { type: 'commands', items: [] } },
        context,
      ).effects,
    ).toEqual([{ type: 'commands', items: [] }])
  })
})

describe('losing the connection', () => {
  it('asks the hub why before deciding what a silent close meant', () => {
    // An expired Access session and a lost network look identical from here:
    // the upgrade is refused before a single frame arrives.
    const result = reduce(
      connected().state,
      { type: 'socket_closed', code: 1006 },
      context,
    )
    expect(result.state.kind).toBe('backoff')
    expect(result.effects).toEqual([{ type: 'probe_auth' }])
  })

  it('asks the user to sign in when that is what the probe found', () => {
    const closed = reduce(
      connected().state,
      { type: 'socket_closed', code: 1006 },
      context,
    )
    const probed = reduce(
      closed.state,
      { type: 'probe_result', result: 'no_auth' },
      context,
    )

    expect(probed.state.kind).toBe('auth_required')
    expect(probed.effects).toEqual([{ type: 'request_login' }])
  })

  it('waits and retries when the hub was simply unreachable', () => {
    const closed = reduce(
      connected().state,
      { type: 'socket_closed', code: 1006 },
      context,
    )
    const probed = reduce(
      closed.state,
      { type: 'probe_result', result: 'unreachable' },
      context,
    )

    expect(probed.state.kind).toBe('backoff')
    expect(probed.effects).toEqual([
      { type: 'schedule', at: (closed.state as { until: number }).until },
    ])
  })

  it('reconnects as soon as the cookie is back', () => {
    const closed = reduce(
      connected().state,
      { type: 'socket_closed', code: 1006 },
      context,
    )
    const waiting = reduce(
      closed.state,
      { type: 'probe_result', result: 'no_auth' },
      context,
    )
    const back = reduce(waiting.state, { type: 'authenticated' }, context)

    expect(back.state.kind).toBe('connecting')
    expect(back.effects).toEqual([{ type: 'open_socket' }])
  })

  it('backs off further with every failure, and never past a minute', () => {
    let state = connected().state
    const delays: number[] = []
    for (let i = 0; i < 10; i++) {
      const closed = reduce(
        state,
        { type: 'socket_closed', code: CLOSE_BAD_FRAME },
        context,
      )
      state = closed.state
      delays.push((state as { until: number }).until - context.now)
    }

    expect(delays.slice(0, 4)).toEqual([750, 1500, 3000, 6000])
    expect(Math.max(...delays)).toBeLessThanOrEqual(60_000)
    expect(delays.at(-1)).toBe(45_000)
  })

  it('spreads reconnects out instead of retrying in lockstep', () => {
    const jittered = (random: number) =>
      reduce(
        connected().state,
        { type: 'socket_closed', code: CLOSE_BAD_FRAME },
        { ...context, random: () => random },
      ).state as { until: number }

    expect(jittered(0).until).not.toBe(jittered(0.9).until)
  })

  it('reconnects when the wait is over', () => {
    const closed = reduce(
      connected().state,
      { type: 'socket_closed', code: CLOSE_BAD_FRAME },
      context,
    )
    const woken = reduce(closed.state, { type: 'timer' }, context)

    expect(woken.state.kind).toBe('connecting')
    expect(woken.effects).toEqual([{ type: 'open_socket' }])
  })

  it('stops trying when the two sides speak different protocols', () => {
    // Retrying cannot fix this, and retrying forever would hide it.
    const result = reduce(
      connected().state,
      { type: 'socket_closed', code: CLOSE_PROTOCOL_VERSION },
      context,
    )
    expect(result.state).toEqual({ kind: 'incompatible' })
    expect(result.effects).toEqual([])

    expect(
      reduce(result.state, { type: 'start', hello: HELLO }, context).effects,
    ).toEqual([])
  })
})

describe('running out of write budget', () => {
  it('waits for the budget to reset rather than hammering the hub', () => {
    const warned = reduce(
      connected().state,
      {
        type: 'frame',
        frame: {
          type: 'error',
          code: 'quota',
          message: 'no budget',
          retryAt: 99_000,
        },
      },
      context,
    )
    expect(warned.state).toMatchObject({
      kind: 'paused_quota',
      retryAt: 99_000,
    })

    const closed = reduce(
      warned.state,
      { type: 'socket_closed', code: CLOSE_QUOTA },
      context,
    )
    expect(closed.effects).toEqual([{ type: 'schedule', at: 99_000 }])
  })

  it('comes back when the deadline passes', () => {
    const paused: WsState = {
      kind: 'paused_quota',
      hello: HELLO,
      retryAt: 99_000,
    }
    expect(reduce(paused, { type: 'timer' }, context).effects).toEqual([
      { type: 'open_socket' },
    ])
  })
})

describe('stopping', () => {
  it('closes the socket and stays closed', () => {
    const stopped = reduce(connected().state, { type: 'stop' }, context)
    expect(stopped.state).toEqual({ kind: 'idle' })
    expect(stopped.effects).toEqual([{ type: 'close_socket' }])

    expect(reduce(stopped.state, { type: 'stop' }, context).effects).toEqual([])
  })
})

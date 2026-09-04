import {
  CLOSE_BAD_FRAME,
  CLOSE_PROTOCOL_VERSION,
  CLOSE_QUOTA,
} from '#/shared/protocol/messages'
import type { Commands, Hello, ServerFrame } from '#/shared/protocol/messages'
import type { Op } from '#/shared/protocol/ops'

/**
 * When to be connected, and what to do when the connection ends.
 *
 * The socket itself, the alarms and the storage all live outside; this decides
 * only what should happen next. Keeping it a plain function is what makes the
 * awkward cases - a session that expired while the browser slept, a hub that is
 * out of write budget, a service worker restarted mid-handshake - testable
 * without a browser and without waiting for real time to pass.
 */

export type WsState =
  | { kind: 'idle' }
  | { kind: 'incompatible' }
  // Every state that leads back to a socket carries the hello it will send.
  // The wiring builds it once, when it asks for a connection; a reconnect that
  // had to build it again would need storage, and this stays a pure function.
  | { kind: 'connecting'; hello: Hello }
  | { kind: 'handshaking'; hello: Hello }
  | { kind: 'open'; hello: Hello }
  | { kind: 'backoff'; hello: Hello; attempt: number; until: number }
  | { kind: 'auth_required'; hello: Hello }
  | { kind: 'paused_quota'; hello: Hello; retryAt: number }

export type WsEvent =
  /** The watchdog alarm, the first run, or anything else that wants a socket. */
  | { type: 'start'; hello: Hello }
  | { type: 'stop' }
  | { type: 'socket_open' }
  | { type: 'socket_closed'; code: number }
  | { type: 'frame'; frame: ServerFrame }
  /** An alarm fired for a deadline this machine asked for. */
  | { type: 'timer' }
  /** What a plain REST call to the hub said, after an unexplained close. */
  | { type: 'probe_result'; result: 'ok' | 'no_auth' | 'unreachable' }
  /** A fresh Access cookie showed up. */
  | { type: 'authenticated' }

export type WsEffect =
  | { type: 'open_socket' }
  | { type: 'close_socket' }
  | { type: 'send_hello'; hello: Hello }
  /** The connection is usable: send whatever is waiting in the queue. */
  | { type: 'flush_queue' }
  | { type: 'schedule'; at: number }
  | { type: 'probe_auth' }
  | { type: 'request_login' }
  | { type: 'apply'; ops: Op[]; seqTo: number }
  | { type: 'acked'; clientSeq: number; seq: number }
  | { type: 'commands'; items: Commands['items'] }

export interface Context {
  now: number
  random: () => number
}

export interface Transition {
  state: WsState
  effects: WsEffect[]
}

/** The first retry waits about a second, the longest about a minute. */
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 60_000

export const initialState = (): WsState => ({ kind: 'idle' })

export function reduce(
  state: WsState,
  event: WsEvent,
  context: Context,
): Transition {
  switch (event.type) {
    case 'start':
      // Every path back to a socket goes through here, so the watchdog alarm
      // can fire as often as it likes without stacking up connections.
      if (
        state.kind === 'idle' ||
        (state.kind === 'backoff' && state.until <= context.now)
      ) {
        return {
          state: { kind: 'connecting', hello: event.hello },
          effects: [{ type: 'open_socket' }],
        }
      }
      return { state, effects: [] }

    case 'stop':
      return {
        state: { kind: 'idle' },
        effects: state.kind === 'idle' ? [] : [{ type: 'close_socket' }],
      }

    case 'socket_open':
      if (!('hello' in state)) return { state, effects: [] }
      return {
        state: { kind: 'handshaking', hello: state.hello },
        effects: [{ type: 'send_hello', hello: state.hello }],
      }

    case 'socket_closed':
      return closed(state, event.code, context)

    case 'frame':
      return frame(state, event.frame, context)

    case 'timer':
      if (state.kind === 'backoff' || state.kind === 'paused_quota') {
        return {
          state: { kind: 'connecting', hello: state.hello },
          effects: [{ type: 'open_socket' }],
        }
      }
      return { state, effects: [] }

    case 'probe_result':
      if (state.kind !== 'backoff') return { state, effects: [] }
      if (event.result === 'no_auth') {
        return {
          state: { kind: 'auth_required', hello: state.hello },
          effects: [{ type: 'request_login' }],
        }
      }
      return { state, effects: [{ type: 'schedule', at: state.until }] }

    case 'authenticated':
      if (state.kind === 'auth_required') {
        return {
          state: { kind: 'connecting', hello: state.hello },
          effects: [{ type: 'open_socket' }],
        }
      }
      return { state, effects: [] }
  }
}

function closed(state: WsState, code: number, context: Context): Transition {
  if (!('hello' in state)) return { state, effects: [] }

  if (code === CLOSE_PROTOCOL_VERSION) {
    // Retrying cannot help: one side has to be updated first.
    return { state: { kind: 'incompatible' }, effects: [] }
  }

  if (code === CLOSE_QUOTA) {
    const retryAt = state.kind === 'paused_quota' ? state.retryAt : context.now
    return {
      state: { kind: 'paused_quota', hello: state.hello, retryAt },
      effects: [{ type: 'schedule', at: retryAt }],
    }
  }

  const attempt = state.kind === 'backoff' ? state.attempt + 1 : 1
  const until = context.now + delay(attempt, context.random)
  const next: WsState = { kind: 'backoff', hello: state.hello, attempt, until }

  // A close with no explanation is the shape an expired Access session takes:
  // the upgrade is refused before the app ever sees a frame. Asking the hub
  // over REST is the only way to tell that apart from a flaky network.
  if (code !== CLOSE_BAD_FRAME) {
    return { state: next, effects: [{ type: 'probe_auth' }] }
  }
  return { state: next, effects: [{ type: 'schedule', at: until }] }
}

function frame(
  state: WsState,
  received: ServerFrame,
  context: Context,
): Transition {
  switch (received.type) {
    case 'welcome':
      if (!('hello' in state)) return { state, effects: [] }
      return {
        state: { kind: 'open', hello: state.hello },
        effects: [{ type: 'flush_queue' }],
      }

    case 'changes':
      return {
        state,
        effects: [{ type: 'apply', ops: received.ops, seqTo: received.seqTo }],
      }

    case 'ack':
      return {
        state,
        effects: [
          {
            type: 'acked',
            clientSeq: received.clientSeq,
            seq: received.seq,
          },
        ],
      }

    case 'commands':
      return { state, effects: [{ type: 'commands', items: received.items }] }

    case 'error':
      if (received.code === 'quota' && 'hello' in state) {
        // The close frame follows; recording the deadline now means the retry
        // is scheduled for when the budget resets rather than immediately.
        return {
          state: {
            kind: 'paused_quota',
            hello: state.hello,
            retryAt: received.retryAt ?? context.now,
          },
          effects: [],
        }
      }
      return { state, effects: [] }
  }
}

function delay(attempt: number, random: () => number): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1))
  // Half fixed, half jittered: two browsers that lost the same hub do not come
  // back in lockstep, but the wait never collapses to nothing either.
  return ceiling / 2 + random() * (ceiling / 2)
}

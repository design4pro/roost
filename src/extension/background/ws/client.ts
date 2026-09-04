import type { browser as Chrome } from 'wxt/browser'
import { decodeServerFrame, encode } from '#/shared/protocol/codec'
import type { ClientFrame, Commands, Hello } from '#/shared/protocol/messages'
import type { Op } from '#/shared/protocol/ops'
import { WS_SUBPROTOCOL } from '#/shared/protocol/ws'
import type { Clock, Random, Secret, Store } from '../deps'
import { probeAuth } from '../auth/fetch'
import type { MirrorStore } from '../mirror/store'
import {
  ack,
  compact,
  enqueue,
  loadQueue,
  needsCompaction,
  saveQueue,
} from './queue'
import type { WsEffect, WsEvent, WsState } from './state-machine'
import { initialState, reduce } from './state-machine'

/**
 * The one connection this browser keeps to its hub.
 *
 * The decisions all live in the reducer; this turns them into a socket, alarms
 * and storage writes, and turns what comes back into events. The service worker
 * is stopped whenever Chrome likes, so `start` has to be safe to call at any
 * moment - the watchdog alarm does exactly that, twice a minute.
 */

/** Traffic resets the service worker's idle timer; silence lets it be killed. */
const PING_MS = 20_000

export const WATCHDOG_ALARM = 'ws-watchdog'
export const RETRY_ALARM = 'ws-retry'

export interface SocketHandlers {
  onOpen: () => void
  onMessage: (data: string) => void
  onClose: (code: number) => void
}

export interface Socket {
  send: (data: string) => void
  close: () => void
}

export type OpenSocket = (
  url: string,
  protocols: string[],
  handlers: SocketHandlers,
) => Socket

export interface ClientDeps {
  browser: typeof Chrome
  store: Store
  mirror: MirrorStore
  openSocket: OpenSocket
  clock: Clock
  random: Random
  workerUrl: string
  deviceId: string
  /** Read per connection, so re-pairing takes effect without a restart. */
  secret: Secret
  /** Built fresh for every connection: it carries the queue's position. */
  hello: () => Promise<Hello>
  /** Everything this device has open, for when the backlog outgrows itself. */
  snapshotAll: () => Promise<Op[]>
  onCommands: (items: Commands['items']) => void
  onApplied: (ops: Op[]) => void
  requestLogin: () => void
}

export interface Client {
  /** Connect if not connected. Safe to call as often as anything likes. */
  start: () => Promise<void>
  stop: () => Promise<void>
  send: (ops: Op[]) => Promise<void>
  authenticated: () => Promise<void>
  handleAlarm: (name: string) => Promise<void>
  state: () => WsState
}

export function createClient(deps: ClientDeps): Client {
  let state: WsState = initialState()
  let socket: Socket | undefined
  let ping: ReturnType<typeof setInterval> | undefined

  const dispatch = async (event: WsEvent): Promise<void> => {
    const result = reduce(state, event, {
      now: deps.clock(),
      random: deps.random,
    })
    state = result.state
    for (const effect of result.effects) await run(effect)
  }

  const run = async (effect: WsEffect): Promise<void> => {
    switch (effect.type) {
      case 'open_socket':
        return open()

      case 'close_socket':
        socket?.close()
        socket = undefined
        stopPing()
        return

      case 'send_hello':
        return sendFrame(effect.hello)

      case 'flush_queue':
        return flushQueue()

      case 'schedule':
        await deps.browser.alarms.create(RETRY_ALARM, { when: effect.at })
        return

      case 'probe_auth': {
        const result = await probeAuth(deps.workerUrl, await deps.secret())
        return dispatch({
          type: 'probe_result',
          result: result === 'ok' ? 'ok' : result,
        })
      }

      case 'request_login':
        deps.requestLogin()
        return

      case 'apply':
        if (effect.ops.length > 0) {
          await deps.mirror.apply(effect.ops, effect.seqTo)
          deps.onApplied(effect.ops)
        }
        return

      case 'acked': {
        const queue = ack(await loadQueue(deps.store), effect.clientSeq)
        await saveQueue(deps.store, queue)
        return
      }

      case 'commands':
        if (effect.items.length > 0) deps.onCommands(effect.items)
        return
    }
  }

  const open = async () => {
    socket?.close()
    const url = new URL('/ws', deps.workerUrl)
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
    url.searchParams.set('device', deps.deviceId)

    // The key goes in the subprotocol list and never in the URL - a browser
    // WebSocket has no other place to put it, and the URL is logged.
    const secret = await deps.secret()
    const protocols =
      secret === undefined ? [WS_SUBPROTOCOL] : [WS_SUBPROTOCOL, secret]

    socket = deps.openSocket(url.toString(), protocols, {
      onOpen: () => void dispatch({ type: 'socket_open' }),
      onMessage: (data) => void receive(data),
      onClose: (code) => {
        stopPing()
        socket = undefined
        void dispatch({ type: 'socket_closed', code })
      },
    })
    startPing()
  }

  const receive = async (data: string) => {
    // The hub answers the keepalive itself, without ever waking up.
    if (data === 'pong') return

    const decoded = decodeServerFrame(data)
    if (!decoded.ok) return
    await dispatch({ type: 'frame', frame: decoded.frame })
  }

  const sendFrame = (frame: ClientFrame) => {
    socket?.send(encode(frame))
  }

  const flushQueue = async () => {
    let queue = await loadQueue(deps.store)
    if (needsCompaction(queue)) {
      // Hours offline leave a history nobody needs: what the hub is missing is
      // the state this browser is in, not the path it took to get there.
      queue = compact(queue, await deps.snapshotAll())
      await saveQueue(deps.store, queue)
    }
    for (const batch of queue.batches) {
      sendFrame({ type: 'ops', clientSeq: batch.clientSeq, ops: batch.ops })
    }
  }

  const startPing = () => {
    stopPing()
    ping = setInterval(() => socket?.send('ping'), PING_MS)
  }

  const stopPing = () => {
    if (ping !== undefined) clearInterval(ping)
    ping = undefined
  }

  return {
    async start() {
      await deps.browser.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 })
      await dispatch({ type: 'start', hello: await deps.hello() })
    },

    async stop() {
      await dispatch({ type: 'stop' })
    },

    async send(ops) {
      if (ops.length === 0) return

      const { lastSeq } = await deps.mirror.read()
      const before = await loadQueue(deps.store)
      const queue = enqueue(before, ops, lastSeq)
      // Written down before it is sent: a worker killed mid-send re-sends the
      // batch, and the hub refuses a repeat by its client sequence number.
      await saveQueue(deps.store, queue)

      if (state.kind === 'open') {
        for (const batch of queue.batches.slice(before.batches.length)) {
          sendFrame({ type: 'ops', clientSeq: batch.clientSeq, ops: batch.ops })
        }
      }
    },

    async authenticated() {
      await dispatch({ type: 'authenticated' })
    },

    async handleAlarm(name) {
      if (name === WATCHDOG_ALARM) return this.start()
      if (name === RETRY_ALARM) return dispatch({ type: 'timer' })
    },

    state: () => state,
  }
}

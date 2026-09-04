import { encode, decodeServerFrame } from '#/shared/protocol/codec'
import type { ClientFrame, ServerFrame } from '#/shared/protocol/messages'
import { PROTOCOL_VERSION } from '#/shared/protocol/ops'
import type { UserHub } from '../user-hub/UserHub'

/**
 * A device, as far as the hub is concerned: one socket and a queue of frames.
 *
 * Tests await the frame they care about rather than a fixed number of them,
 * because the hub is free to split a welcome across as many `changes` frames as
 * it likes and a test that counted them would break on an unrelated change.
 */
export interface TestClient {
  socket: WebSocket
  send: (frame: ClientFrame) => void
  hello: (options?: {
    lastSeq?: number
    protocol?: number
    deviceId?: string
  }) => void
  next: <T extends ServerFrame['type']>(
    type: T,
    predicate?: (frame: Extract<ServerFrame, { type: T }>) => boolean,
  ) => Promise<Extract<ServerFrame, { type: T }>>
  closed: () => Promise<{ code: number; reason: string }>
}

export async function connect(
  hub: DurableObjectStub<UserHub>,
  deviceId: string,
): Promise<TestClient> {
  const response = await hub.fetch(
    new Request(`https://hub/ws?device=${deviceId}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )
  const socket = response.webSocket
  if (!socket) throw new Error('the hub did not upgrade the connection')
  socket.accept()

  const received: ServerFrame[] = []
  let close: { code: number; reason: string } | undefined
  const wake: Array<() => void> = []
  const notify = () => {
    for (const resolve of wake.splice(0)) resolve()
  }

  socket.addEventListener('message', (event) => {
    const decoded = decodeServerFrame(event.data)
    if (decoded.ok) received.push(decoded.frame)
    notify()
  })
  socket.addEventListener('close', (event) => {
    close = { code: event.code, reason: event.reason }
    notify()
  })

  const settle = () =>
    new Promise<void>((resolve) => {
      wake.push(resolve)
      // Nothing else will arrive if the socket is already closed.
      if (close) resolve()
    })

  return {
    socket,
    send: (frame) => socket.send(encode(frame)),
    hello: (options = {}) =>
      socket.send(
        encode({
          type: 'hello',
          protocol: options.protocol ?? PROTOCOL_VERSION,
          deviceId: options.deviceId ?? deviceId,
          name: `Chrome (${deviceId})`,
          os: 'macOS',
          browserVersion: '141',
          extensionVersion: '0.1.0',
          lastSeq: options.lastSeq ?? 0,
          lastClientSeq: 0,
        }),
      ),
    async next(type, predicate) {
      for (;;) {
        const index = received.findIndex(
          (frame) =>
            frame.type === type &&
            (!predicate ||
              predicate(frame as Extract<ServerFrame, { type: typeof type }>)),
        )
        if (index >= 0) {
          return received.splice(index, 1)[0] as never
        }
        if (close) {
          throw new Error(
            `socket closed (${close.code} ${close.reason}) while waiting for ${type}`,
          )
        }
        await settle()
      }
    },
    async closed() {
      while (!close) await settle()
      return close
    },
  }
}

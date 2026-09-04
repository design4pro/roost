import { defineBackground } from 'wxt/utils/define-background'
import { browser } from 'wxt/browser'
import { startBackground } from '../background'
import type { SocketHandlers } from '../background/ws/client'

/**
 * The only place that reaches for the real clock, the real random source and a
 * real socket. Everything below takes them as arguments so it can be tested.
 */
export default defineBackground(() => {
  void startBackground({
    browser,
    clock: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    random: () => Math.random(),
    openSocket: (
      url: string,
      protocols: string[],
      handlers: SocketHandlers,
    ) => {
      const socket = new WebSocket(url, protocols)
      socket.addEventListener('open', () => handlers.onOpen())
      socket.addEventListener('message', (event: MessageEvent<string>) =>
        handlers.onMessage(event.data),
      )
      socket.addEventListener('close', (event: CloseEvent) =>
        handlers.onClose(event.code),
      )
      // A socket that failed to open reports an error and then a close; only
      // the close matters here, and it always follows.
      socket.addEventListener('error', () => socket.close())

      return {
        send: (data: string) => socket.send(data),
        close: () => socket.close(),
      }
    },
  })
})

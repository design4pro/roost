import type { Browser, browser as Chrome } from 'wxt/browser'
import type { Op } from '#/shared/protocol/ops'
import type { ConnectionStatus, PortMessage } from '../port/protocol'
import { DashboardMessage, PORT_NAME } from '../port/protocol'
import type { MirrorStore } from './mirror/store'

/**
 * The dashboard's window onto the worker.
 *
 * A port rather than one-off messages, because the dashboard needs to be told
 * when something changes and a message would need somewhere to arrive. The
 * first thing down a new port is the whole state; everything after it is ops.
 */

export interface PortHubDeps {
  browser: typeof Chrome
  mirror: MirrorStore
  deviceId: string
  connection: () => ConnectionStatus
  /** What the page asked for, once it has been checked. */
  onMessage: (message: DashboardMessage) => Promise<void>
}

export interface PortHub {
  /** Tell every open dashboard what just changed. */
  broadcast: (ops: Op[]) => void
  /** Tell every open dashboard that the connection changed. */
  announce: () => void
}

export function createPortHub(deps: PortHubDeps): PortHub {
  const ports = new Set<Browser.runtime.Port>()

  const send = (port: Browser.runtime.Port, message: PortMessage) => {
    try {
      port.postMessage(message)
    } catch {
      // The page went away between the check and the send; the disconnect
      // listener will clean up after it.
    }
  }

  deps.browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return

    ports.add(port)
    port.onDisconnect.addListener(() => ports.delete(port))

    port.onMessage.addListener((raw) => {
      const parsed = DashboardMessage.safeParse(raw)
      // A message that does not parse is a bug in the page, not something the
      // worker should guess at.
      if (parsed.success) void deps.onMessage(parsed.data)
    })

    void deps.mirror.read().then(({ mirror }) =>
      send(port, {
        type: 'state',
        mirror,
        deviceId: deps.deviceId,
        connection: deps.connection(),
      }),
    )
  })

  return {
    broadcast(ops) {
      if (ops.length === 0) return
      for (const port of ports) {
        send(port, { type: 'patch', ops, connection: deps.connection() })
      }
    },

    announce() {
      for (const port of ports) {
        send(port, { type: 'patch', ops: [], connection: deps.connection() })
      }
    },
  }
}

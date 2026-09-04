import { useEffect, useRef, useState } from 'react'
import { browser } from 'wxt/browser'
import { applyOps } from '#/shared/mirror/apply'
import type { Mirror } from '#/shared/mirror/types'
import { emptyMirror } from '#/shared/mirror/types'
import type {
  ConnectionStatus,
  DashboardMessage,
  PortMessage,
} from '#/extension/port/protocol'
import { PORT_NAME } from '#/extension/port/protocol'

/**
 * The page's copy of the model, kept in step with the worker's.
 *
 * The port is also the liveness signal: Chrome tears it down when the service
 * worker is stopped, so a disconnect is not an error but the cue to connect
 * again, which is what wakes the worker back up.
 */
export interface PortState {
  mirror: Mirror
  deviceId: string
  connection: ConnectionStatus
  /** Ask the worker for something; it answers by changing the mirror. */
  send: (message: DashboardMessage) => void
}

const initial = {
  mirror: emptyMirror(),
  deviceId: '',
  connection: 'connecting' as ConnectionStatus,
}

export function usePort(): PortState {
  const [state, setState] = useState(initial)
  const current = useRef<ReturnType<typeof browser.runtime.connect>>(undefined)

  useEffect(() => {
    let closed = false
    let port: ReturnType<typeof browser.runtime.connect> | undefined

    const connect = () => {
      if (closed) return
      port = browser.runtime.connect({ name: PORT_NAME })
      current.current = port

      port.onMessage.addListener((message) => {
        const update = message as PortMessage
        setState((previous) =>
          update.type === 'state'
            ? {
                mirror: update.mirror,
                deviceId: update.deviceId,
                connection: update.connection,
              }
            : {
                ...previous,
                mirror: applyOps(previous.mirror, update.ops),
                connection: update.connection,
              },
        )
      })

      port.onDisconnect.addListener(() => {
        setState((previous) => ({ ...previous, connection: 'connecting' }))
        connect()
      })
    }

    connect()
    return () => {
      closed = true
      port?.disconnect()
    }
  }, [])

  return {
    ...state,
    send: (message) => current.current?.postMessage(message),
  }
}

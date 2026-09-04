import { z } from 'zod'
import type { Mirror } from '#/shared/mirror/types'
import { CommandBody } from '#/shared/protocol/ops'
import type { Op } from '#/shared/protocol/ops'

/**
 * What the dashboard and the service worker say to each other.
 *
 * The dashboard is a page that comes and goes while the model lives in the
 * worker, so a connection starts with the whole state and continues as the same
 * ops the hub sends. One shape of update, one `applyOps` on the other end.
 */

export const PORT_NAME = 'dashboard'

/** What to tell the user about the connection, if anything. */
export type ConnectionStatus =
  | 'connecting'
  | 'online'
  | 'offline'
  | 'auth_required'
  | 'paused_quota'
  | 'incompatible'

export interface StateMessage {
  type: 'state'
  mirror: Mirror
  /** Which device this browser is, so its own rows can be marked as local. */
  deviceId: string
  connection: ConnectionStatus
}

export interface PatchMessage {
  type: 'patch'
  ops: Op[]
  connection: ConnectionStatus
}

export type PortMessage = StateMessage | PatchMessage

/**
 * What the dashboard asks for. Validated rather than trusted: the page is the
 * extension's own, but a port is a message channel like any other and the
 * worker acts on what arrives down it.
 */
export const DashboardMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('command'),
    target: z.string(),
    body: CommandBody,
  }),
  z.object({ type: z.literal('restore'), windowId: z.string() }),
  // The dashboard names the folder; the worker turns it into the list of nodes
  // to recreate, because that reading of the mirror is not the page's job.
  z.object({ type: z.literal('copy'), bookmarkId: z.string() }),
])
export type DashboardMessage = z.infer<typeof DashboardMessage>

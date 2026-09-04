import { encode } from '#/shared/protocol/codec'
import type { ServerFrame } from '#/shared/protocol/messages'

/**
 * Sockets are tagged with their device id when accepted, which is what makes
 * "everyone but the sender" and "that one device" single calls rather than a
 * membership list this object would have to keep across hibernation.
 */
export interface SocketHost {
  getWebSockets: (tag?: string) => WebSocket[]
}

export function broadcast(
  host: SocketHost,
  frame: ServerFrame,
  exceptTag?: string,
): void {
  const payload = encode(frame)
  for (const socket of host.getWebSockets()) {
    if (exceptTag !== undefined && tagOf(socket) === exceptTag) continue
    send(socket, payload)
  }
}

export function sendTo(
  host: SocketHost,
  tag: string,
  frame: ServerFrame,
): void {
  const payload = encode(frame)
  for (const socket of host.getWebSockets(tag)) send(socket, payload)
}

export function sendFrame(socket: WebSocket, frame: ServerFrame): void {
  send(socket, encode(frame))
}

function send(socket: WebSocket, payload: string): void {
  try {
    socket.send(payload)
  } catch {
    // The peer went away between `getWebSockets` and the write. There is
    // nothing to do about it and nothing to tell the caller: the close event
    // that follows is where presence is updated.
  }
}

/** A socket's device id, from the attachment written when it was accepted. */
export function tagOf(socket: WebSocket): string | undefined {
  const attachment = (
    socket as WebSocket & { deserializeAttachment: () => unknown }
  ).deserializeAttachment()
  if (
    attachment &&
    typeof attachment === 'object' &&
    'deviceId' in attachment
  ) {
    const { deviceId } = attachment as { deviceId: unknown }
    return typeof deviceId === 'string' ? deviceId : undefined
  }
  return undefined
}

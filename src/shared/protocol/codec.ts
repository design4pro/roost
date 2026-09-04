import { ClientFrame, ServerFrame } from './messages'

/**
 * Cloudflare accepts WebSocket messages up to 1 MiB. Frames are built to stay
 * well under that - `changes` is chunked by the server - so anything at the
 * limit is a bug or an attack, and is cheaper to reject than to parse.
 */
export const MAX_FRAME_BYTES = 1024 * 1024

export type Decoded<T> = { ok: true; frame: T } | { ok: false; reason: string }

export function encode(frame: ClientFrame | ServerFrame): string {
  return JSON.stringify(frame)
}

function decode<T>(
  raw: unknown,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
): Decoded<T> {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'frame is not text' }
  }
  // Byte length, not string length: a frame of astral-plane characters is up to
  // four times its length in bytes, and the limit is about bytes on the wire.
  if (new TextEncoder().encode(raw).byteLength > MAX_FRAME_BYTES) {
    return { ok: false, reason: 'frame exceeds the size limit' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'frame is not JSON' }
  }

  const result = schema.safeParse(parsed)
  if (!result.success || result.data === undefined) {
    return { ok: false, reason: 'frame does not match the protocol' }
  }
  return { ok: true, frame: result.data }
}

export const decodeClientFrame = (raw: unknown): Decoded<ClientFrame> =>
  decode(raw, ClientFrame)

export const decodeServerFrame = (raw: unknown): Decoded<ServerFrame> =>
  decode(raw, ServerFrame)

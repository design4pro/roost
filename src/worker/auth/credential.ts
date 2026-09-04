import { WS_SUBPROTOCOL } from '#/shared/protocol/ws'

/**
 * Where the pairing key is on a request, without deciding whether it is right.
 *
 * Two shapes, because a browser WebSocket cannot set headers: REST requests
 * carry `Authorization: Bearer`, and the upgrade carries the key as the second
 * entry of its subprotocol list. Keeping this pure and away from `env` is what
 * makes the header shapes cheap to test - the comparison itself needs crypto
 * and lives in `verify.ts`.
 */

/** The offered key, or null when the request carries none we recognise. */
export function readCredential(request: Request): string | null {
  const authorization = request.headers.get('Authorization')
  if (authorization) {
    // RFC 7235 makes the scheme case-insensitive; Chrome sends what we wrote,
    // but curl and the docs will not always.
    const match = /^Bearer +(.+)$/i.exec(authorization.trim())
    return match?.[1] ?? null
  }

  const offered = subprotocols(request)
  // Exactly two entries: the protocol name and the key. A list without the
  // name is not ours, and a longer one is ambiguous about which entry to trust.
  if (offered.length !== 2 || offered[0] !== WS_SUBPROTOCOL) return null
  return offered[1] ?? null
}

/** Whether the client asked for our subprotocol, and so expects it echoed. */
export function offersSubprotocol(request: Request): boolean {
  return subprotocols(request).includes(WS_SUBPROTOCOL)
}

function subprotocols(request: Request): string[] {
  const header = request.headers.get('Sec-WebSocket-Protocol')
  if (!header) return []
  return header
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

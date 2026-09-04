/**
 * Talking to the Worker as a paired browser.
 *
 * The hub trusts one thing: the pairing key set on it at deploy time. Every
 * request carries it as a bearer token, which is what tells "this browser was
 * never paired, or was paired with a different key" apart from "the hub is not
 * reachable at all".
 */

export type ProbeResult = 'ok' | 'no_auth' | 'unreachable'

export type Fetch = typeof globalThis.fetch

/** The header both the health probe and the hub's own routing agree on. */
export function bearer(secret: string): Record<string, string> {
  return { authorization: `Bearer ${secret}` }
}

/**
 * Why the socket closed: a key the hub refuses, or a hub that is simply not
 * there. The two look identical from a WebSocket, which is refused during the
 * upgrade and reports nothing but 1006.
 */
export async function probeAuth(
  workerUrl: string,
  secret: string | undefined,
  doFetch: Fetch = fetch,
): Promise<ProbeResult> {
  // No key at all is the same answer as a rejected one, and asking the hub
  // about it would only be a round trip to hear so.
  if (secret === undefined) return 'no_auth'

  try {
    const response = await doFetch(new URL('/api/health', workerUrl), {
      headers: bearer(secret),
    })
    if (response.status === 401 || response.status === 403) return 'no_auth'
    return response.ok || response.status === 204 ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

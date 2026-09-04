import { timingSafeEqual } from 'node:crypto'
import { readCredential } from './credential'

/**
 * The hub trusts one thing: the pairing key set on it at deploy time.
 *
 * There is one deployment per person, so there is no identity to establish -
 * only whether the caller holds the key. That makes the answer a boolean, and
 * makes an unset key the most dangerous state there is: a Worker deployed
 * without `PAIRING_SECRET` must refuse everything rather than serve everyone.
 */

export interface VerifierEnv {
  /** Set at deploy time. Absent or empty means nothing is let through. */
  PAIRING_SECRET?: string
}

export type Verifier = (request: Request) => Promise<boolean>

export function createVerifier(env: VerifierEnv): Verifier {
  const expected = env.PAIRING_SECRET ?? ''

  return async (request) => {
    if (expected === '') return false

    const offered = readCredential(request)
    if (offered === null) return false

    return timingSafeEqualStrings(offered, expected)
  }
}

/**
 * Compared as SHA-256 digests rather than as the bytes of the keys themselves.
 *
 * `timingSafeEqual` throws on buffers of different lengths, so feeding it the
 * raw keys would turn a wrong-length guess into an exception instead of a 401 -
 * and would leak the key's length by which of the two happened. A digest is 32
 * bytes whatever went into it.
 */
async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  return timingSafeEqual(new Uint8Array(left), new Uint8Array(right))
}

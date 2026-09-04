/**
 * Everything the background code needs from the outside world.
 *
 * Only the entrypoint is allowed to reach for the real clock, the real random
 * source or the real storage; every module below it takes what it needs as an
 * argument. That is what makes the cores testable without a fake browser and
 * what keeps `Date.now()` out of code whose behaviour depends on time.
 */

export type Clock = () => number

export type Uuid = () => string

/** A number in [0, 1), for the connection backoff jitter. */
export type Random = () => number

export interface Store {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
  remove: (key: string) => Promise<void>
}

/**
 * The pairing key this browser was given, read fresh on every use.
 *
 * A getter rather than a string: re-pairing writes a new key to storage
 * without restarting the service worker, so a value captured at wiring time
 * would be the old one on the next connection attempt.
 */
export type Secret = () => Promise<string | undefined>

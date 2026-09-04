/**
 * When to stop waiting for more changes and read the browser.
 *
 * Chrome fires events far faster than it is worth writing rows for: dragging a
 * tab across a window emits an update per pixel-worth of movement. Each key is
 * given a quiet period, and the whole buffer is flushed once the oldest key has
 * waited long enough or once there are simply too many keys to keep holding.
 */

/** How long a key waits for a follow-up event before it is worth reading. */
const QUIET_MS = 300

/** How long the oldest key may wait, however busy the browser stays. */
const MAX_WAIT_MS = 500

/** How many keys may pile up before waiting stops being the cheaper option. */
const MAX_KEYS = 100

export interface Coalescer {
  keys: Record<string, { markedAt: number; firstMarkedAt: number }>
}

export interface Tick {
  /** Keys to read now, in the order they were first marked. */
  flush?: string[]
  /** When to call `tick` again, if nothing else happens first. */
  nextDeadline?: number
}

export const emptyCoalescer = (): Coalescer => ({ keys: {} })

export function mark(state: Coalescer, key: string, now: number): Coalescer {
  const existing = state.keys[key]
  return {
    keys: {
      ...state.keys,
      [key]: { markedAt: now, firstMarkedAt: existing?.firstMarkedAt ?? now },
    },
  }
}

export function tick(state: Coalescer, now: number): [Coalescer, Tick] {
  const entries = Object.entries(state.keys)
  if (entries.length === 0) return [state, {}]

  const due =
    entries.length >= MAX_KEYS ||
    entries.some(
      ([, at]) =>
        now - at.markedAt >= QUIET_MS || now - at.firstMarkedAt >= MAX_WAIT_MS,
    )

  if (!due) {
    const deadlines = entries.map(([, at]) =>
      Math.min(at.markedAt + QUIET_MS, at.firstMarkedAt + MAX_WAIT_MS),
    )
    return [state, { nextDeadline: Math.min(...deadlines) }]
  }

  // Everything goes at once, not just the keys that came due: a flush reads the
  // browser anyway, and a key held back would only be read again moments later.
  const flush = entries
    .sort((a, b) => a[1].firstMarkedAt - b[1].firstMarkedAt)
    .map(([key]) => key)
  return [emptyCoalescer(), { flush }]
}

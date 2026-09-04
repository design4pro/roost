import type { Store } from '../deps'

/**
 * Which commands this browser has already carried out.
 *
 * The hub delivers a command at least once - it keeps it until the target says
 * it is done, and a service worker can be stopped between doing the work and
 * saying so. Closing the same tab twice is harmless, but creating the same
 * bookmark twice is not, so every command is remembered by id.
 *
 * A ring rather than a set: the memory only has to outlive redelivery, and an
 * unbounded list of ids would grow for the life of the profile.
 */
export const RING_SIZE = 1000

const STORE_KEY = 'appliedCommands'

/** Pure: the ring with `id` at the end, oldest ids dropped past the limit. */
export function remember(
  ring: readonly string[],
  id: string,
  size = RING_SIZE,
): string[] {
  const without = ring.filter((entry) => entry !== id)
  return [...without, id].slice(-size)
}

export interface AppliedRing {
  seen: (id: string) => Promise<boolean>
  record: (id: string) => Promise<void>
}

export function createAppliedRing(store: Store): AppliedRing {
  const read = async () => (await store.get<string[]>(STORE_KEY)) ?? []

  return {
    async seen(id) {
      return (await read()).includes(id)
    },

    async record(id) {
      await store.set(STORE_KEY, remember(await read(), id))
    },
  }
}

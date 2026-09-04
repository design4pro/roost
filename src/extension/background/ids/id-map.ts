import type { Store, Uuid } from '../deps'

/**
 * Stable ids for things Chrome only numbers for the length of a session.
 *
 * Tab and window ids are reused across restarts and swapped out under the app's
 * feet when a tab is discarded, so nothing durable can be keyed by them. Every
 * tab, window and group therefore gets a UUID the first time it is seen, kept
 * in session storage so it survives the service worker being shut down but not
 * the browser being closed.
 */
export type IdKind = 'tab' | 'window' | 'group'

const STORE_KEY = 'idMap'

type Table = Partial<Record<IdKind, Record<string, string>>>

export interface IdMap {
  /** The id for this thing, minting one if it has not been seen before. */
  uuidFor: (kind: IdKind, chromeId: number) => Promise<string>
  /** The id for this thing, or nothing if it has not been seen before. */
  peek: (kind: IdKind, chromeId: number) => Promise<string | undefined>
  chromeIdFor: (kind: IdKind, uuid: string) => Promise<number | undefined>
  /** Move an id to a new number, for a tab Chrome replaced under us. */
  remap: (kind: IdKind, from: number, to: number) => Promise<void>
  forget: (kind: IdKind, chromeId: number) => Promise<void>
}

export function createIdMap(store: Store, uuid: Uuid): IdMap {
  // Read once, then keep the table in memory: every captured event asks for
  // several ids, and the service worker is stopped often enough that reading
  // storage per lookup would be the dominant cost of a flush.
  let loaded: Promise<Table> | undefined

  const table = () =>
    (loaded ??= store.get<Table>(STORE_KEY).then((t) => t ?? {}))

  const save = async (next: Table) => {
    loaded = Promise.resolve(next)
    await store.set(STORE_KEY, next)
  }

  return {
    async uuidFor(kind, chromeId) {
      const current = await table()
      const existing = current[kind]?.[chromeId]
      if (existing !== undefined) return existing

      const minted = uuid()
      await save({
        ...current,
        [kind]: { ...current[kind], [chromeId]: minted },
      })
      return minted
    },

    async peek(kind, chromeId) {
      return (await table())[kind]?.[chromeId]
    },

    async chromeIdFor(kind, uuid_) {
      const entries = Object.entries((await table())[kind] ?? {})
      const found = entries.find(([, value]) => value === uuid_)
      return found ? Number(found[0]) : undefined
    },

    async remap(kind, from, to) {
      const current = await table()
      const existing = current[kind]?.[from]
      if (existing === undefined) return

      const { [String(from)]: _dropped, ...rest } = current[kind] ?? {}
      await save({ ...current, [kind]: { ...rest, [to]: existing } })
    },

    async forget(kind, chromeId) {
      const current = await table()
      if (current[kind]?.[chromeId] === undefined) return

      const { [String(chromeId)]: _dropped, ...rest } = current[kind] ?? {}
      await save({ ...current, [kind]: rest })
    },
  }
}

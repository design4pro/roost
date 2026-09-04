import type { Browser } from 'wxt/browser'
import type { Store } from './deps'

/**
 * The two storage areas, behind one small interface.
 *
 * `local` holds what has to survive the browser being closed - the device's
 * identity, the mirror, the outbound queue. `session` holds what is only
 * meaningful while the browser is running, above all the map from Chrome's
 * session-scoped ids to ours, which would be actively wrong if it outlived the
 * session it describes.
 */
export function createStore(area: Browser.storage.StorageArea): Store {
  return {
    async get<T>(key: string) {
      const result = await area.get(key)
      return result[key] as T | undefined
    },
    set: (key, value) => area.set({ [key]: value }),
    remove: (key) => area.remove(key),
  }
}

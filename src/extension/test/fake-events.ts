/**
 * Listeners the fake browser does not implement.
 *
 * `@webext-core/fake-browser` covers tabs, windows and storage but throws on
 * everything else, which is enough to stop the background worker before it has
 * wired anything up. These stand-ins accept listeners and can be triggered from
 * a test; the ones the fake browser does implement are left alone, because
 * their real behaviour is what the tests are checking.
 */

interface FakeEvent {
  addListener: (listener: (...args: never[]) => void) => void
  removeListener: (listener: (...args: never[]) => void) => void
  hasListener: () => boolean
  trigger: (...args: never[]) => void
}

const fakeEvent = (): FakeEvent => {
  const listeners = new Set<(...args: never[]) => void>()
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    hasListener: () => listeners.size > 0,
    trigger: (...args) => listeners.forEach((listener) => listener(...args)),
  }
}

const PATHS = [
  'tabs.onMoved',
  'tabs.onAttached',
  'tabs.onDetached',
  'tabs.onActivated',
  'tabs.onReplaced',
  'tabGroups.onUpdated',
  'tabGroups.onMoved',
  'tabGroups.onRemoved',
  'bookmarks.onCreated',
  'bookmarks.onChanged',
  'bookmarks.onMoved',
  'bookmarks.onRemoved',
  'bookmarks.onChildrenReordered',
  'bookmarks.onImportBegan',
  'bookmarks.onImportEnded',
  'cookies.onChanged',
  'runtime.onConnect',
  'action.onClicked',
]

/** Replace every listener the fake browser refuses to register. */
export function installMissingEvents(target: Record<string, never>): void {
  for (const path of PATHS) {
    const [namespace, event] = path.split('.') as [string, string]
    let api = target[namespace] as Record<string, unknown> | undefined
    if (api === undefined) {
      // A namespace the fake browser leaves out entirely, such as `action`.
      api = {}
      ;(target as Record<string, unknown>)[namespace] = api
    }

    const existing = api[event] as FakeEvent | undefined
    try {
      const probe = () => undefined
      existing?.addListener(probe)
      existing?.removeListener(probe)
    } catch {
      api[event] = fakeEvent()
    }
  }
}

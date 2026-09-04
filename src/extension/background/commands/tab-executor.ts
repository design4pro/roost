import type { browser as Chrome } from 'wxt/browser'
import type { CommandBody } from '#/shared/protocol/ops'
import type { IdMap } from '../ids/id-map'

/**
 * Doing what another device asked, to tabs and windows this one owns.
 *
 * A missing id is success, not failure: the command exists because a tab was
 * on screen somewhere a moment ago, and a tab that has since been closed is
 * exactly the state the sender was asking for.
 */
export interface TabExecutorDeps {
  browser: typeof Chrome
  ids: IdMap
}

/** Whether this executor recognised the command; bookmarks are elsewhere. */
export async function executeTabCommand(
  body: CommandBody,
  deps: TabExecutorDeps,
): Promise<boolean> {
  switch (body.kind) {
    case 'tab.close': {
      const id = await deps.ids.chromeIdFor('tab', body.tabId)
      if (id !== undefined) await remove(() => deps.browser.tabs.remove(id))
      return true
    }

    case 'tab.activate': {
      const id = await deps.ids.chromeIdFor('tab', body.tabId)
      if (id === undefined) return true

      const tab = await deps.browser.tabs.update(id, { active: true })
      // Activating a tab in a window the user cannot see is not activating it.
      const windowId: number | undefined = tab?.windowId
      if (windowId !== undefined) {
        await deps.browser.windows.update(windowId, { focused: true })
      }
      return true
    }

    case 'window.close': {
      const id = await deps.ids.chromeIdFor('window', body.windowId)
      if (id !== undefined) await remove(() => deps.browser.windows.remove(id))
      return true
    }

    default:
      return false
  }
}

/** Chrome throws when the thing is already gone, which is the desired end. */
async function remove(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch {
    // Already closed.
  }
}

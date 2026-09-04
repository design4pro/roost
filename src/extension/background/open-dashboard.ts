import type { browser as Chrome } from 'wxt/browser'

/**
 * One dashboard, not one per click.
 *
 * The dashboard is a full page rather than a popup, so clicking the toolbar
 * button again should bring back the page the user already has - opening a
 * second copy of a list of every tab they own would be its own small joke.
 */

/** The tab already showing the dashboard, if there is one. */
export function pickDashboardTab<T extends { url?: string; id?: number }>(
  tabs: T[],
  dashboardUrl: string,
): T | undefined {
  return tabs.find(
    (tab) => tab.url?.startsWith(dashboardUrl) && tab.id !== undefined,
  )
}

export async function openDashboard(browser: typeof Chrome): Promise<void> {
  const url = browser.runtime.getURL('/dashboard.html')
  const existing = pickDashboardTab(await browser.tabs.query({}), url)

  if (existing?.id !== undefined) {
    await browser.tabs.update(existing.id, { active: true })
    // Chrome's types promise a window id on every tab; a tab in the middle of
    // being detached has none, and focusing `undefined` is an exception.
    const { windowId } = existing as { windowId?: number }
    if (windowId !== undefined)
      await browser.windows.update(windowId, { focused: true })
    return
  }

  await browser.tabs.create({ url })
}

import { connectSecondDevice } from './helpers/second-device'
import { seedBookmarks, seedWindow } from './helpers/seed'
import { expect, test } from './fixtures/extension'

/** Typed just enough for the snippets that run inside the service worker. */
declare const chrome: { runtime: { reload: () => void } }

/**
 * The dashboard has to keep looking like part of Chrome, and the way that
 * drifts is one token at a time. Favicons are masked: they come from Chrome's
 * own cache and differ between machines.
 */
test.describe('the dashboard, visually', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`a window of tabs in ${scheme}`, async ({
      context,
      serviceWorker,
      dashboardUrl,
    }) => {
      const other = await connectSecondDevice()
      await serviceWorker.evaluate(() => chrome.runtime.reload())
      await seedWindow(other, { tabs: 12 })

      const page = await context.newPage()
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(dashboardUrl)
      await page.getByRole('treeitem', { name: /Second device/ }).click()
      await page.getByRole('treeitem', { name: /Second device page 0/ }).click()
      await expect(page.getByRole('option').first()).toBeVisible()

      await expect(page).toHaveScreenshot(`dashboard-${scheme}.png`, {
        mask: [page.locator('img')],
      })

      other.close()
    })

    test(`a folder of bookmarks in ${scheme}`, async ({
      context,
      serviceWorker,
      dashboardUrl,
    }) => {
      const other = await connectSecondDevice()
      await serviceWorker.evaluate(() => chrome.runtime.reload())
      await seedBookmarks(other)

      const page = await context.newPage()
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(dashboardUrl)
      await page.getByRole('treeitem', { name: /Second device/ }).click()
      await page
        .getByRole('treeitem', { name: /Bookmarks bar/ })
        .press('ArrowRight')
      await page.getByRole('treeitem', { name: /Second device folder/ }).click()
      await expect(page.getByRole('option').first()).toBeVisible()

      await expect(page).toHaveScreenshot(`bookmarks-${scheme}.png`, {
        mask: [page.locator('img')],
      })

      other.close()
    })
  }
})

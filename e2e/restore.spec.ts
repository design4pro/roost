import type { Page } from '@playwright/test'
import { connectSecondDevice } from './helpers/second-device'
import { seedWindow } from './helpers/seed'
import { expect, test } from './fixtures/extension'

/** Typed just enough for the snippets that run inside the service worker. */
declare const chrome: {
  runtime: { reload: () => void }
  tabs: { query: (info: object) => Promise<Array<{ url?: string }>> }
  windows: { getAll: () => Promise<Array<{ id?: number }>> }
}

const restore = async (page: Page) => {
  await page.getByRole('treeitem', { name: /Second device/ }).click()
  await page.getByRole('treeitem', { name: /Second device page 0/ }).click()
  await page.getByRole('button', { name: /Restore window here/ }).click()
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
}

test.describe('restoring a window from another device', () => {
  test('opens one page and leaves the rest waiting', async ({
    context,
    serviceWorker,
    dashboardUrl,
  }) => {
    const other = await connectSecondDevice()
    await serviceWorker.evaluate(() => chrome.runtime.reload())
    await seedWindow(other, { tabs: 30 })

    const page = await context.newPage()
    await page.goto(dashboardUrl)
    await restore(page)

    await expect
      .poll(
        () =>
          serviceWorker.evaluate(async () => {
            const tabs = await chrome.tabs.query({})
            return {
              real: tabs.filter(
                (tab) => tab.url === 'https://example.com/page-0',
              ).length,
              lazy: tabs.filter((tab) => tab.url?.includes('lazy.html')).length,
            }
          }),
        { timeout: 30_000 },
      )
      .toEqual({ real: 1, lazy: 29 })

    // The restored window is this browser's own from here on, with the real
    // addresses rather than the placeholders.
    await expect(
      page.getByRole('treeitem', { name: /Playwright Chrome/ }),
    ).toBeVisible()

    other.close()
  })

  test('stays responsive while it fills a 250-tab window', async ({
    context,
    serviceWorker,
    dashboardUrl,
  }) => {
    test.slow()
    const other = await connectSecondDevice()
    await serviceWorker.evaluate(() => chrome.runtime.reload())
    await seedWindow(other, { tabs: 250 })

    const page = await context.newPage()
    await page.goto(dashboardUrl)
    await restore(page)

    // Measured while the restore is still running, which is the only time the
    // question is interesting.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = Date.now()
      await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' })
      expect(Date.now() - started).toBeLessThan(2000)

      const paint = await page.evaluate(() => performance.now())
      expect(paint).toBeLessThan(2000)
    }

    await expect
      .poll(
        () =>
          serviceWorker.evaluate(
            async () =>
              (await chrome.tabs.query({})).filter((tab) =>
                tab.url?.includes('lazy.html'),
              ).length,
          ),
        { timeout: 120_000 },
      )
      .toBe(249)

    other.close()
  })
})

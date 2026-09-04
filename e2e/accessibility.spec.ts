import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { connectSecondDevice } from './helpers/second-device'
import { seedBookmarks, seedWindow } from './helpers/seed'
import { expect, test } from './fixtures/extension'

/** Typed just enough for the snippets that run inside the service worker. */
declare const chrome: {
  storage: { local: { remove: (keys: string | string[]) => Promise<void> } }
  runtime: { reload: () => void }
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

const audit = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(violations).toEqual([])
}

test.describe('accessibility', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`onboarding in ${scheme}`, async ({
      context,
      serviceWorker,
      dashboardUrl,
    }) => {
      // The fixture pairs the browser; onboarding is the state before that.
      await serviceWorker.evaluate(() =>
        chrome.storage.local.remove(['workerUrl', 'pairingSecret']),
      )

      const page = await context.newPage()
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(dashboardUrl)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await audit(page)
    })

    test(`the empty dashboard in ${scheme}`, async ({
      context,
      dashboardUrl,
    }) => {
      const page = await context.newPage()
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(dashboardUrl)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await audit(page)
    })

    test(`a populated dashboard in ${scheme}`, async ({
      context,
      serviceWorker,
      dashboardUrl,
    }) => {
      const other = await connectSecondDevice()
      await serviceWorker.evaluate(() => chrome.runtime.reload())
      await seedWindow(other, { tabs: 8 })

      const page = await context.newPage()
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(dashboardUrl)
      await page.getByRole('treeitem', { name: /Second device/ }).click()
      await page.getByRole('treeitem', { name: /Second device page 0/ }).click()
      await expect(page.getByRole('option').first()).toBeVisible()

      await audit(page)
      other.close()
    })
  }

  test('an open row menu and the restore dialog', async ({
    context,
    serviceWorker,
    dashboardUrl,
  }) => {
    const other = await connectSecondDevice()
    await serviceWorker.evaluate(() => chrome.runtime.reload())
    await seedWindow(other, { tabs: 5 })

    const page = await context.newPage()
    await page.goto(dashboardUrl)
    await page.getByRole('treeitem', { name: /Second device/ }).click()
    await page.getByRole('treeitem', { name: /Second device page 0/ }).click()

    await page.getByRole('button', { name: /Second device page 1/ }).focus()
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menu')).toBeVisible()
    await audit(page)

    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Restore window here/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await audit(page)

    other.close()
  })

  test('an expanded bookmark tree and the folder it opens', async ({
    context,
    serviceWorker,
    dashboardUrl,
  }) => {
    const other = await connectSecondDevice()
    await serviceWorker.evaluate(() => chrome.runtime.reload())
    await seedBookmarks(other)

    const page = await context.newPage()
    await page.goto(dashboardUrl)
    await page.getByRole('treeitem', { name: /Second device/ }).click()
    await page.getByRole('treeitem', { name: /Bookmarks bar/ }).click()
    await page
      .getByRole('treeitem', { name: /Bookmarks bar/ })
      .press('ArrowRight')
    await expect(
      page.getByRole('treeitem', { name: /Second device folder/ }),
    ).toBeVisible()

    await audit(page)
    other.close()
  })

  test('the placeholder page', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(
      `chrome-extension://${extensionId}/lazy.html?u=https%3A%2F%2Fexample.com%2F&t=Example`,
    )
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await audit(page)
  })
})

import { connectSecondDevice } from './helpers/second-device'
import { seedWindow } from './helpers/seed'
import { expect, test } from './fixtures/extension'

/** Typed just enough for the snippets that run inside the service worker. */
declare const chrome: { runtime: { reload: () => void } }

test.describe('the dashboard', () => {
  test('shows what another device has open, and filters it', async ({
    context,
    serviceWorker,
    dashboardUrl,
  }) => {
    const other = await connectSecondDevice()
    await serviceWorker.evaluate(() => chrome.runtime.reload())
    await seedWindow(other, { tabs: 5 })

    const page = await context.newPage()
    await page.goto(dashboardUrl)

    // The device is in the sidebar; its window appears once it is opened.
    const device = page.getByRole('treeitem', { name: /Second device/ })
    await expect(device).toBeVisible()
    await device.click()
    await page.getByRole('treeitem', { name: /Second device page 0/ }).click()

    await expect(page.getByRole('option')).toHaveCount(6) // five tabs, one group
    await expect(page.getByText('Second device page 3')).toBeVisible()

    await page.getByLabel(/Search/).fill('page 3')
    await expect(page.getByText('Second device page 3')).toBeVisible()
    await expect(page.getByText('Second device page 0')).toHaveCount(0)

    other.close()
  })

  test('never parks a focused row under the sticky header', async ({
    context,
    serviceWorker,
    dashboardUrl,
  }) => {
    const other = await connectSecondDevice()
    await serviceWorker.evaluate(() => chrome.runtime.reload())
    await seedWindow(other, { tabs: 60 })

    const page = await context.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(dashboardUrl)

    await page.getByRole('treeitem', { name: /Second device/ }).click()
    await page.getByRole('treeitem', { name: /Second device page 0/ }).click()

    // Walk the whole list with the keyboard; a row that scrolled into view has
    // to clear the header, which is what `scroll-margin-top` is there for.
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press('Tab')

      const clear = await page.evaluate(() => {
        const active = document.activeElement
        const header = document.querySelector('[data-testid="panel-header"]')
        if (active === null || header === null) return true

        const row = active.getBoundingClientRect()
        const sticky = header.getBoundingClientRect()
        // Only rows of the list are under the header at all.
        if (active.closest('[role="listbox"]') === null) return true
        return row.top >= sticky.bottom - 1
      })

      expect(clear).toBe(true)
    }

    other.close()
  })

  test('opens a row menu from the keyboard', async ({
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

    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem').first()).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(
      page.getByRole('button', { name: /Second device page 1/ }),
    ).toBeFocused()

    other.close()
  })
})

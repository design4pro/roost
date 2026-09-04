import { connectSecondDevice } from './helpers/second-device'
import { expect, test } from './fixtures/extension'

/** Typed just enough for the snippets that run inside the service worker. */
declare const chrome: {
  storage: { local: { set: (values: object) => Promise<void> } }
  runtime: { reload: () => void }
}

test.describe('syncing between two devices', () => {
  test('a tab opened here shows up there', async ({
    context,
    serviceWorker,
  }) => {
    const other = await connectSecondDevice()

    // The extension only connects once it has been told where its hub is, and
    // the fixture does that as it wakes the worker up.
    await serviceWorker.evaluate(() => chrome.runtime.reload())
    const page = await context.newPage()
    await page.goto('https://example.com/')

    const changes = await other.next(
      'changes',
      (frame) =>
        frame.type === 'changes' &&
        frame.ops.some((op) => op.op === 'window_snapshot'),
      15_000,
    )

    expect(changes.type).toBe('changes')
    other.close()
  })
})

import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { installMissingEvents } from './fake-events'
import { createFakeBookmarks } from './fake-bookmarks'

// The fake browser keeps its state between tests unless it is told not to, and
// resetting it puts back the listeners it does not implement.
beforeEach(() => {
  fakeBrowser.reset()
  installMissingEvents(fakeBrowser as never)
  // Every Chrome profile has the permanent bookmark roots, and the fake browser
  // has no bookmarks at all; the methods are replaced but not the events.
  Object.assign(
    fakeBrowser.bookmarks,
    createFakeBookmarks({
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          title: 'Bookmarks bar',
          folderType: 'bookmarks-bar',
          children: [],
        },
        {
          id: '2',
          title: 'Other bookmarks',
          folderType: 'other',
          children: [],
        },
      ],
    }),
  )
})

// Vitest runs without globals here, so Testing Library's own auto-cleanup never
// registers itself and a rendered tree would outlive its test.
afterEach(cleanup)

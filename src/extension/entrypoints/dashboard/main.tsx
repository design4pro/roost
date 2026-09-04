import { createRoot } from 'react-dom/client'
import { browser } from 'wxt/browser'
import { App } from '#/extension/dashboard/App'
import '#/styles/app.css'

// The page's language has to match what `chrome.i18n` will actually return, or
// a screen reader announces English strings with Polish pronunciation rules.
document.documentElement.lang = browser.i18n.getUILanguage()

const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)

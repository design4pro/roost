import { browser } from 'wxt/browser'
import { t } from '#/extension/dashboard/i18n'
import '#/styles/app.css'

/**
 * The placeholder a restored tab sits on until someone looks at it.
 *
 * A restored window of 200 tabs must not fetch 200 pages, so every tab but the
 * first is this page with the real address in the query string. It navigates
 * when the tab is actually shown, which is the same moment Chrome would have
 * loaded a discarded tab, and the page keeps the tab's title and favicon so the
 * strip looks like the window it came from.
 */
const params = new URLSearchParams(location.search)
const url = params.get('u') ?? ''
const title = params.get('t') ?? url
const favicon = params.get('f')

document.title = title
document.documentElement.lang = browser.i18n.getUILanguage()

if (favicon !== null && favicon !== '') {
  const link = document.createElement('link')
  link.rel = 'icon'
  link.href = favicon
  document.head.appendChild(link)
}

const root = document.getElementById('root')
if (root !== null) {
  root.className = 'mx-auto mt-24 max-w-[480px] px-6 text-center'
  root.innerHTML = `
    <h1 class="text-[15px] font-medium"></h1>
    <p class="text-on-surface-variant"></p>
    <button type="button" class="mt-4 h-9 rounded-pill border-0 bg-primary px-6 text-on-primary"></button>
  `

  root.querySelector('h1')!.textContent = title
  root.querySelector('p')!.textContent = hostOf(url)

  const button = root.querySelector('button')!
  button.textContent = t('lazy_load')
  button.addEventListener('click', () => void load())
}

// Chrome shows a restored tab the moment the user clicks it, which is exactly
// when the real page should start loading.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void load()
})
if (document.visibilityState === 'visible') void load()

async function load(): Promise<void> {
  if (url === '') return

  if (url.startsWith('http:') || url.startsWith('https:')) {
    // `replace`, so the placeholder does not sit in the tab's history.
    location.replace(url)
    return
  }

  // A `file:` URL cannot be navigated to from a page; the worker can do it if
  // the user has allowed this extension to open local files.
  await browser.runtime.sendMessage({ type: 'lazy.open-file', url })
}

function hostOf(candidate: string): string {
  try {
    return new URL(candidate).host || candidate
  } catch {
    return candidate
  }
}

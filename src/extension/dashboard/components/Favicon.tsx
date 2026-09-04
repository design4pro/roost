import { browser } from 'wxt/browser'
import { Icon } from './Icon'

/**
 * Chrome's own favicon cache, which is why this needs the `favicon`
 * permission: a tab of another browser has a `favIconUrl` we could not fetch
 * from here, but the page URL is enough for Chrome to hand us the icon it
 * already has.
 */
export function Favicon({ url }: { url: string }) {
  const source = faviconUrl(url)

  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-card bg-container">
      {source === undefined ? (
        <Icon name="window" className="size-4 fill-on-surface-variant" />
      ) : (
        <img src={source} alt="" width={16} height={16} className="size-4" />
      )}
    </span>
  )
}

export function faviconUrl(url: string): string | undefined {
  if (!url.startsWith('http')) return undefined

  const query = new URLSearchParams({ pageUrl: url, size: '32' })
  return browser.runtime.getURL(`/_favicon/?${query.toString()}`)
}

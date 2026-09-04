import { browser } from 'wxt/browser'

/**
 * Every user-visible string comes from `_locales`.
 *
 * Chrome picks the file, so there is no language state to manage here - only a
 * thin wrapper that keeps the call sites short and gives a missing key a shape
 * that is obvious on screen rather than an empty string that is not.
 */
export function t(key: string, ...substitutions: string[]): string {
  const message = browser.i18n.getMessage(key as never, substitutions)
  return message === '' ? `!${key}` : message
}

/**
 * Where the hub comes from, and what guards it.
 *
 * The repository address is here rather than in a component because it is the
 * same address the README's deploy button points at, and the two must not
 * drift - a `scripts/deploy-button.test.ts` asserts they agree.
 */
export const REPO_URL = 'https://github.com/design4pro/chrome-extension-roost'

export const DEPLOY_URL = `https://deploy.workers.cloudflare.com/?url=${REPO_URL}`

/**
 * A key strong enough to be the only thing between the internet and every tab
 * the user has open: 256 bits, base64url so it survives a copy, a paste and a
 * WebSocket subprotocol list without escaping.
 */
export function generateSecret(
  randomBytes: (into: Uint8Array<ArrayBuffer>) => void = (into) =>
    crypto.getRandomValues(into),
): string {
  const bytes = new Uint8Array(32)
  randomBytes(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

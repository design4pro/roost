import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REPO_URL } from '#/extension/dashboard/pairing'

/**
 * What the "Deploy to Cloudflare" button needs to be true of this repository.
 *
 * None of it is checked by a compiler, and all of it fails on somebody else's
 * machine rather than ours: a missing secret declaration produces a Worker that
 * answers 401 to everything with no explanation, and a stale repository address
 * sends the user to a deploy page for a project that is not this one.
 */

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const packageJson = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>
  cloudflare?: { bindings?: Record<string, { description?: string }> }
}
const devVars = read('.dev.vars.example')

/** Every `NAME=` at the start of a line - what the deploy form asks about. */
const declared = [...devVars.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
  (match) => match[1] as string,
)

describe('.dev.vars.example', () => {
  it('declares the pairing key, which is what makes the form ask for it', () => {
    expect(declared).toContain('PAIRING_SECRET')
  })

  it('has a description for every secret it declares', () => {
    // The description is the only guidance the user gets at the moment they
    // have to invent a value.
    const bindings = packageJson.cloudflare?.bindings ?? {}
    for (const name of declared) {
      expect(bindings[name]?.description ?? '').not.toBe('')
    }
  })
})

describe('the build command Cloudflare will infer', () => {
  it('builds the Worker, not the extension', () => {
    // Workers Builds pre-fills its build command from `build`. Ours used to be
    // `wxt build`, which builds a browser extension and deploys nothing.
    expect(packageJson.scripts.build).toContain('wrangler')
  })

  it('survives an install in a container without a git checkout hook', () => {
    // `pnpm install` runs both of these in the build container. A failure in
    // either is a failed install, which is a failed deploy for a stranger.
    expect(packageJson.scripts.postinstall).toContain('|| true')
    expect(packageJson.scripts.prepare).toContain('|| true')
  })
})

describe('the repository address', () => {
  it('is the same one the README hands to the button', () => {
    expect(read('README.md')).toContain(
      `https://deploy.workers.cloudflare.com/?url=${REPO_URL}`,
    )
  })
})

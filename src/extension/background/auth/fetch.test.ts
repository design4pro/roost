import { describe, expect, it, vi } from 'vitest'
import type { Fetch } from './fetch'
import { bearer, probeAuth } from './fetch'

const responding = (...responses: Array<Response | Error>) => {
  const calls: Array<[URL | string, RequestInit | undefined]> = []
  const doFetch = vi.fn((input: unknown, init?: RequestInit) => {
    calls.push([input as URL | string, init])
    const next = responses.shift()
    return next instanceof Error
      ? Promise.reject(next)
      : Promise.resolve(next ?? new Response(null, { status: 204 }))
  }) as unknown as Fetch
  return { doFetch, calls }
}

describe('asking the hub whether it accepts our key', () => {
  it('reads a healthy answer as paired', async () => {
    const { doFetch } = responding(new Response(null, { status: 204 }))
    expect(await probeAuth('https://sync.test', 'key', doFetch)).toBe('ok')
  })

  it.each([401, 403])('reads %i as a key the hub refuses', async (status) => {
    const { doFetch } = responding(new Response(null, { status }))
    expect(await probeAuth('https://sync.test', 'key', doFetch)).toBe('no_auth')
  })

  it('reads a failed request as a network problem, not a key problem', async () => {
    const { doFetch } = responding(new Error('offline'))
    expect(await probeAuth('https://sync.test', 'key', doFetch)).toBe(
      'unreachable',
    )
  })

  it('does not ask at all when this browser has no key', async () => {
    const { doFetch, calls } = responding()
    expect(await probeAuth('https://sync.test', undefined, doFetch)).toBe(
      'no_auth',
    )
    expect(calls).toHaveLength(0)
  })

  it('carries the key as a bearer token', async () => {
    const { doFetch, calls } = responding()
    await probeAuth('https://sync.test', 'key', doFetch)

    expect(calls[0]?.[1]?.headers).toEqual({ authorization: 'Bearer key' })
    // Never in the URL: the Worker's invocation logs record it.
    expect(String(calls[0]?.[0])).not.toContain('key')
  })
})

describe('bearer', () => {
  it('is the header both ends agree on', () => {
    expect(bearer('s3cret')).toEqual({ authorization: 'Bearer s3cret' })
  })
})

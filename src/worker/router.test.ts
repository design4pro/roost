import { describe, expect, it, vi } from 'vitest'
import { WS_SUBPROTOCOL } from '#/shared/protocol/ws'
import type { RouterEnv } from './router'
import { route } from './router'

const DEVICE = '00000000-0000-4000-8000-000000000000'

/**
 * The hub, as something that records whether it was reached at all.
 *
 * That is the assertion this file exists for: authorisation happens before
 * routing, so a request without the key must not touch the Durable Object -
 * not even to be handed a 401 by it.
 */
const spyEnv = () => {
  const fetch = vi.fn(() => new Response('hub', { status: 200 }))
  const getByName = vi.fn(() => ({ fetch }))
  const env = {
    USER_HUB: {
      idFromName: (name: string) => name,
      get: getByName,
    },
  } as unknown as RouterEnv
  return { env, getByName, fetch }
}

const yes = () => Promise.resolve(true)
const no = () => Promise.resolve(false)

const upgrade = (path = `/ws?device=${DEVICE}`) =>
  new Request(`https://hub${path}`, {
    headers: {
      Upgrade: 'websocket',
      'Sec-WebSocket-Protocol': `${WS_SUBPROTOCOL}, key`,
    },
  })

describe('what an unauthorised request reaches', () => {
  it('never reaches the hub', async () => {
    const { env, getByName } = spyEnv()
    const response = await route(upgrade(), env, no)

    expect(response.status).toBe(401)
    expect(getByName).not.toHaveBeenCalled()
  })

  it('is refused with 401, not with a protocol complaint', async () => {
    // A 400 or 426 here would tell an unauthenticated caller that the route
    // exists and what it wants next.
    const { env } = spyEnv()
    const bare = new Request('https://hub/ws')

    expect((await route(bare, env, no)).status).toBe(401)
  })

  it('is not cached, so re-pairing takes effect at once', async () => {
    const { env } = spyEnv()
    const response = await route(upgrade(), env, no)

    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('what an authorised request reaches', () => {
  it('answers the health probe without waking the hub', async () => {
    const { env, getByName } = spyEnv()
    const request = new Request('https://hub/api/health')
    const response = await route(request, env, yes)

    expect(response.status).toBe(204)
    expect(getByName).not.toHaveBeenCalled()
  })

  it('hands a websocket upgrade to the one hub this deployment has', async () => {
    const { env, getByName, fetch } = spyEnv()
    await route(upgrade(), env, yes)

    expect(getByName).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['no device tag', '/ws', 400],
    ['a device tag that is not a uuid', '/ws?device=device-a', 400],
  ])('refuses %s', async (_name, path, status) => {
    const { env, getByName } = spyEnv()
    const request = new Request(`https://hub${path}`, {
      headers: { Upgrade: 'websocket' },
    })

    expect((await route(request, env, yes)).status).toBe(status)
    expect(getByName).not.toHaveBeenCalled()
  })

  it('refuses a plain GET on the socket route', async () => {
    const { env } = spyEnv()
    const request = new Request(`https://hub/ws?device=${DEVICE}`)

    expect((await route(request, env, yes)).status).toBe(426)
  })

  it.each(['/auth/done', '/api/snapshot', '/'])(
    'has nothing at %s',
    async (path) => {
      // Both of the first two used to exist. A route that answers anything but
      // 404 here is one that outlived the reason it was added.
      const { env } = spyEnv()

      expect(
        (await route(new Request(`https://hub${path}`), env, yes)).status,
      ).toBe(404)
    },
  )
})

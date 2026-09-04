import type { Verifier } from './auth/verify'

export interface RouterEnv {
  USER_HUB: DurableObjectNamespace
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The one Durable Object this deployment has.
 *
 * One hub per Cloudflare account, because the account is the person: there is
 * no identity in the request to name it after any more. It stays here rather
 * than in `src/shared` - the extension has no business knowing it.
 */
const HUB_NAME = 'user'

const unauthorized = () =>
  new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      // The extension reads this answer to tell "the key is wrong" from "the
      // network is down", and a cached 401 would keep saying the former long
      // after the user has re-paired.
      'cache-control': 'no-store',
    },
  })

export async function route(
  request: Request,
  env: RouterEnv,
  verify: Verifier,
): Promise<Response> {
  const url = new URL(request.url)

  // Before the routing, not inside it: an unauthenticated request must not
  // reach the Durable Object even to be told no.
  if (!(await verify(request))) return unauthorized()

  switch (url.pathname) {
    // Used to tell "the key is wrong" apart from "the network is down" after a
    // socket closes with 1006, which carries no reason of its own.
    case '/api/health':
      return new Response(null, { status: 204 })

    case '/ws': {
      const device = url.searchParams.get('device')
      if (!device || !UUID.test(device)) {
        return new Response('a valid ?device= is required', { status: 400 })
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected a websocket upgrade', { status: 426 })
      }
      return hub(env).fetch(request)
    }

    default:
      return new Response('not found', { status: 404 })
  }
}

const hub = (env: RouterEnv) =>
  env.USER_HUB.get(env.USER_HUB.idFromName(HUB_NAME))

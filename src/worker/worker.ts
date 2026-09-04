import { createVerifier } from './auth/verify'
import type { Verifier, VerifierEnv } from './auth/verify'
import { route } from './router'
import type { RouterEnv } from './router'

export { UserHub } from './user-hub/UserHub'

export interface Env extends VerifierEnv, RouterEnv {}

// Built once per isolate. It closes over the secret, so a `wrangler secret put`
// takes effect on the next isolate rather than the next request - which is what
// re-pairing after a rotation asks the user to wait for.
let verifier: Verifier | undefined

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    verifier ??= createVerifier(env)
    return route(request, env, verifier)
  },
} satisfies ExportedHandler<Env>

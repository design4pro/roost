import { describe, expect, it } from 'vitest'
import { WS_SUBPROTOCOL } from '#/shared/protocol/ws'
import { createVerifier } from './verify'

const SECRET = 'a-key-of-some-length'
const verify = createVerifier({ PAIRING_SECRET: SECRET })

const asking = (headers: Record<string, string>) =>
  new Request('https://hub/api/health', { headers })

describe('checking the pairing key', () => {
  it('accepts the key as a bearer token', async () => {
    expect(await verify(asking({ Authorization: `Bearer ${SECRET}` }))).toBe(
      true,
    )
  })

  it('accepts the key from a subprotocol list', async () => {
    const request = asking({
      'Sec-WebSocket-Protocol': `${WS_SUBPROTOCOL}, ${SECRET}`,
    })
    expect(await verify(request)).toBe(true)
  })

  it('refuses a different key', async () => {
    expect(await verify(asking({ Authorization: 'Bearer nope' }))).toBe(false)
  })

  it('refuses a key that is only a prefix of the right one', async () => {
    // The comparison runs over digests, so a wrong length is a plain no rather
    // than the exception a raw byte comparison would throw.
    const short = SECRET.slice(0, 4)
    expect(await verify(asking({ Authorization: `Bearer ${short}` }))).toBe(
      false,
    )
  })

  it('refuses a request carrying no key', async () => {
    expect(await verify(asking({}))).toBe(false)
  })

  it.each([undefined, ''])(
    'refuses everything when the deployment has no key set (%s)',
    async (secret) => {
      // A Worker deployed without the secret must be shut, not open.
      const unset = createVerifier({ PAIRING_SECRET: secret })
      expect(await unset(asking({ Authorization: 'Bearer ' }))).toBe(false)
      expect(await unset(asking({ Authorization: 'Bearer anything' }))).toBe(
        false,
      )
      expect(await unset(asking({}))).toBe(false)
    },
  )
})

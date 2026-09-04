import { describe, expect, it } from 'vitest'
import { WS_SUBPROTOCOL } from '#/shared/protocol/ws'
import { offersSubprotocol, readCredential } from './credential'

const asking = (headers: Record<string, string>) =>
  new Request('https://hub/ws', { headers })

describe('finding the key a request offers', () => {
  it.each([
    ['a bearer token', { Authorization: 'Bearer k' }, 'k'],
    ['a lowercase scheme', { Authorization: 'bearer k' }, 'k'],
    ['an odd-cased scheme', { Authorization: 'BeArEr k' }, 'k'],
    ['extra spacing', { Authorization: '  Bearer   k  ' }, 'k'],
    ['another scheme entirely', { Authorization: 'Basic k' }, null],
    ['a scheme with nothing after it', { Authorization: 'Bearer' }, null],
    ['an empty header', { Authorization: '' }, null],
    ['no header at all', {}, null],
  ])('reads %s', (_name, headers, expected) => {
    expect(readCredential(asking(headers))).toBe(expected)
  })

  it.each([
    ['the protocol and a key', `${WS_SUBPROTOCOL}, k`, 'k'],
    ['no space after the comma', `${WS_SUBPROTOCOL},k`, 'k'],
    ['the protocol alone', WS_SUBPROTOCOL, null],
    ['a third entry', `${WS_SUBPROTOCOL}, k, extra`, null],
    ['the key first', `k, ${WS_SUBPROTOCOL}`, null],
    ['someone else’s protocol', 'graphql-ws, k', null],
    ['an empty list', '', null],
  ])('reads a subprotocol list with %s', (_name, header, expected) => {
    expect(readCredential(asking({ 'Sec-WebSocket-Protocol': header }))).toBe(
      expected,
    )
  })

  it('prefers the header when a request somehow carries both', () => {
    // Only a hand-written client can produce this; picking one deterministically
    // beats letting the answer depend on header order.
    const request = asking({
      Authorization: 'Bearer from-header',
      'Sec-WebSocket-Protocol': `${WS_SUBPROTOCOL}, from-list`,
    })
    expect(readCredential(request)).toBe('from-header')
  })
})

describe('whether the client expects our protocol echoed', () => {
  it.each([
    [`${WS_SUBPROTOCOL}, k`, true],
    [WS_SUBPROTOCOL, true],
    ['graphql-ws', false],
    ['', false],
  ])('reads %s as %s', (header, expected) => {
    expect(
      offersSubprotocol(asking({ 'Sec-WebSocket-Protocol': header })),
    ).toBe(expected)
  })

  it('is false when there is no such header', () => {
    expect(offersSubprotocol(asking({}))).toBe(false)
  })
})
